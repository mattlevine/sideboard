import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { attachMcpUiProxyHandlers } from './proxy-server.js';
import type { McpUiSession } from './session.js';

export type McpUiProxyListen = {
  urlFor(server: string, dirsKey?: string): string;
  headers: Record<string, string>;
  close(): Promise<void>;
};

/** Loopback Streamable HTTP so Claude and the iframe share one upstream session. */
export async function listenMcpUiProxy(opts: {
  sessionFor(server: string, dirsKey: string): Promise<McpUiSession | null>;
}): Promise<McpUiProxyListen> {
  const token = randomBytes(24).toString('hex');
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('mcp-ui proxy failed to bind');
  const origin = `http://127.0.0.1:${addr.port}`;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    const target = parseMcpUiProxyPath(req.url);
    if (!target) {
      res.writeHead(404).end();
      return;
    }
    try {
      const session = await opts.sessionFor(target.server, target.dirsKey);
      if (!session) {
        res.writeHead(404).end();
        return;
      }
      const header = req.headers['mcp-session-id'];
      const sid = typeof header === 'string' ? header : '';
      let transport = sid ? transports.get(`${target.server}:${sid}`) : undefined;
      if (!transport) {
        if (req.method !== 'POST') {
          res.writeHead(400).end();
          return;
        }
        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          allowedHosts: ['127.0.0.1', 'localhost'],
          onsessioninitialized: (id) => {
            transports.set(`${target.server}:${id}`, created);
          },
          onsessionclosed: (id) => {
            transports.delete(`${target.server}:${id}`);
          },
        });
        transport = created;
        const mcp = new Server(
          { name: `sideboard-ui-proxy-${target.server}`, version: '1.0.0' },
          { capabilities: { tools: {}, resources: {}, prompts: {} } },
        );
        attachMcpUiProxyHandlers(mcp, session);
        await mcp.connect(created);
      }
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
    }
  }

  return {
    urlFor(server: string, dirsKey?: string) {
      const base = `${origin}/s/${encodeURIComponent(server)}`;
      return dirsKey ? `${base}/d/${dirsKey}` : base;
    },
    headers: { Authorization: `Bearer ${token}` },
    async close() {
      await Promise.all([...transports.values()].map((item) => item.close().catch(() => undefined)));
      transports.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export function parseMcpUiProxyPath(url: string | undefined): { server: string; dirsKey: string } | null {
  const path = (url ?? '').split('?')[0] ?? '';
  if (!path.startsWith('/s/')) return null;
  const rest = path.slice(3).replace(/\/$/, '');
  const split = rest.indexOf('/d/');
  try {
    if (split < 0) {
      const server = decodeURIComponent(rest).trim();
      return server ? { server, dirsKey: '' } : null;
    }
    const server = decodeURIComponent(rest.slice(0, split)).trim();
    const dirsKey = rest.slice(split + 3);
    if (!server || !/^[a-f0-9]{16}$/.test(dirsKey)) return null;
    return { server, dirsKey };
  } catch {
    return null;
  }
}
