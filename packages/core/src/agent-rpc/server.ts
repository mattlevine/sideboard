import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  AGENT_RPC_PATH,
  AGENT_RPC_PROTOCOL_VERSION,
  AGENT_RPC_TOKEN_QUERY,
  isJsonRpcRequest,
  parseRpcFrame,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  RPC_UNAUTHORIZED,
  rpcError,
  rpcNotify,
  rpcResult,
  type JsonRpcId,
} from './protocol.js';
import {
  clearAgentRuntimeMetadataIfOwned,
  writeAgentRuntimeMetadata,
  type AgentRuntimeMetadata,
} from './metadata.js';
import {
  createAgentRpcDispatcher,
  type AgentRpcCallContext,
  type AgentRpcHandler,
} from './handlers.js';

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authTokenFromUpgrade(req: IncomingMessage): string {
  try {
    const url = new URL(req.url ?? '', 'http://127.0.0.1');
    return url.searchParams.get(AGENT_RPC_TOKEN_QUERY) ?? '';
  } catch {
    return '';
  }
}

function sendJson(ws: WebSocket, value: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(value));
}

export type AgentRpcServerOptions = {
  host?: string;
  port?: number;
  handlers?: Record<string, AgentRpcHandler>;
  cwd?: () => string;
};

export class AgentRpcServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private meta: AgentRuntimeMetadata | null = null;
  private readonly handlers: Record<string, AgentRpcHandler>;
  private readonly cwd: () => string;

  constructor(opts: AgentRpcServerOptions = {}) {
    this.handlers = opts.handlers ?? createAgentRpcDispatcher();
    this.cwd = opts.cwd ?? (() => process.cwd());
  }

  get metadata(): AgentRuntimeMetadata | null {
    return this.meta;
  }

  get url(): string | null {
    return this.meta?.transports[0]?.url ?? null;
  }

  async listen(opts: { host?: string; port?: number } = {}): Promise<AgentRuntimeMetadata> {
    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? 0;
    const authToken = randomBytes(24).toString('base64url');
    // Token must exist before the TCP socket accepts upgrades so verifyClient
    // can fail closed instead of racing the first connection.
    this.meta = {
      runtimeId: randomUUID(),
      pid: process.pid,
      protocolVersion: AGENT_RPC_PROTOCOL_VERSION,
      authToken,
      startedAt: Date.now(),
      transports: [],
    };
    const http = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const wss = new WebSocketServer({
      server: http,
      path: AGENT_RPC_PATH,
      verifyClient: (info) => this.authorizeUpgrade(info.req),
    });
    wss.on('connection', (ws) => this.attach(ws));

    try {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          http.off('error', reject);
          resolve();
        });
      });
    } catch (err) {
      this.meta = null;
      throw err;
    }

    const addr = http.address();
    if (!addr || typeof addr === 'string') {
      this.meta = null;
      http.close();
      throw new Error('Agent RPC failed to bind a TCP port');
    }
    this.http = http;
    this.wss = wss;
    const url = `ws://${host}:${addr.port}${AGENT_RPC_PATH}`;
    this.meta = {
      ...this.meta,
      transports: [{ kind: 'websocket', url }],
    };
    writeAgentRuntimeMetadata(this.meta);
    return this.meta;
  }

  private authorizeUpgrade(req: IncomingMessage): boolean {
    const expected = this.meta?.authToken ?? '';
    const got = authTokenFromUpgrade(req);
    return Boolean(expected && got && tokensEqual(got, expected));
  }

  private attach(ws: WebSocket): void {
    ws.on('message', (data) => {
      void this.onMessage(ws, data.toString());
    });
    ws.on('error', () => {
      // A misbehaving client must not take the desktop down; the socket closes itself.
    });
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    const parsed = parseRpcFrame(raw);
    if (parsed === undefined) {
      sendJson(ws, rpcError(null, RPC_PARSE_ERROR, 'Parse error'));
      return;
    }
    if (!isJsonRpcRequest(parsed)) {
      sendJson(ws, rpcError(null, RPC_INVALID_REQUEST, 'Invalid request'));
      return;
    }
    const id: JsonRpcId = parsed.id;
    const expected = this.meta?.authToken ?? '';
    const got = typeof parsed.authToken === 'string' ? parsed.authToken : '';
    if (!expected || !got || !tokensEqual(got, expected)) {
      sendJson(ws, rpcError(id, RPC_UNAUTHORIZED, 'Unauthorized'));
      return;
    }
    const handler = this.handlers[parsed.method];
    if (!handler) {
      sendJson(ws, rpcError(id, RPC_METHOD_NOT_FOUND, `Method not found: ${parsed.method}`));
      return;
    }
    const ctx: AgentRpcCallContext = {
      cwd: this.cwd(),
      notify: (method, params) => sendJson(ws, rpcNotify(method, params)),
    };
    try {
      const result = await handler(parsed.params, ctx);
      sendJson(ws, rpcResult(id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === 'object' && 'rpcCode' in err && typeof err.rpcCode === 'number'
          ? err.rpcCode
          : RPC_INTERNAL_ERROR;
      sendJson(ws, rpcError(id, code, message));
    }
  }

  async close(): Promise<void> {
    // Synchronous and first: Electron `will-quit` does not await us, and a
    // stale metadata file would make the next turn skip MCP for a dead socket.
    clearAgentRuntimeMetadataIfOwned();
    this.meta = null;
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      for (const client of wss.clients) {
        try {
          client.close();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    const http = this.http;
    this.http = null;
    if (http) {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  }
}

let running: AgentRpcServer | null = null;

export async function startAgentRpcServer(
  opts: AgentRpcServerOptions = {},
): Promise<AgentRpcServer> {
  if (running) return running;
  const server = new AgentRpcServer(opts);
  try {
    await server.listen({ host: opts.host, port: opts.port });
  } catch (err) {
    await server.close().catch(() => undefined);
    throw err;
  }
  running = server;
  return server;
}

export async function stopAgentRpcServer(): Promise<void> {
  const server = running;
  running = null;
  if (server) await server.close();
}

export function getAgentRpcServer(): AgentRpcServer | null {
  return running;
}
