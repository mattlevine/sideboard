import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { slackOAuthBounceResponse } from './oauth-redirect.js';
import { runSlackSocketMode } from './socket-mode.js';
import { parseSlackRelayClientMessage } from './relay-protocol.js';
import { SlackRelayHub } from './relay-hub.js';

export interface SlackRelayServerOptions {
  appToken: string;
  port?: number;
  host?: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  fetchImpl?: typeof fetch;
  /** Injected hub (tests). */
  hub?: SlackRelayHub;
}

export interface SlackRelayServerHandle {
  port: number;
  url: string;
  hub: SlackRelayHub;
  close: () => Promise<void>;
}

/**
 * Hosted Slack inbound relay: one Socket Mode connection (xapp- on the server)
 * plus desktop WebSocket sessions that register via bot-token auth.test.
 */
export async function startSlackRelayServer(
  opts: SlackRelayServerOptions,
): Promise<SlackRelayServerHandle> {
  const log = opts.onLog ?? console.log;
  const appToken = opts.appToken.trim();
  if (!appToken.startsWith('xapp-')) {
    throw new Error('SIDEBOARD_SLACK_APP_TOKEN must be an xapp-… app-level token');
  }

  const hub =
    opts.hub ??
    new SlackRelayHub({
      fetchImpl: opts.fetchImpl,
      onLog: log,
    });

  const httpServer: Server = createServer((req, res) => {
    const bounce = slackOAuthBounceResponse(req.url || '/');
    if (bounce) {
      res.writeHead(bounce.status, bounce.headers);
      res.end(bounce.body);
      return;
    }
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'sideboard-slack-relay',
          sessions: hub.listSessions().length,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/desktop' });
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const socket = {
      send: (data: string) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: (code?: number, reason?: string) => {
        try {
          ws.close(code, reason);
        } catch {
          // ignore
        }
      },
    };
    log('desktop connected');
    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      const msg = parseSlackRelayClientMessage(raw);
      if (!msg) {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid message' }));
        return;
      }
      void hub.handleClientMessage(socket, msg);
    });
    ws.on('close', () => {
      hub.detachSocket(socket);
    });
    ws.on('error', () => {
      hub.detachSocket(socket);
    });
  });

  const port = opts.port ?? 0;
  const host = opts.host ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });
  const address = httpServer.address();
  const boundPort =
    typeof address === 'object' && address ? address.port : typeof port === 'number' ? port : 0;
  const url = `ws://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}/desktop`;
  log(`relay listening on ${url}`);

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const socketModeDone = runSlackSocketMode({
    appToken,
    signal: ac.signal,
    fetchImpl: opts.fetchImpl,
    onLog: (line) => log(line),
    onEvent: (msg) => {
      hub.routeEvent(msg);
    },
  }).catch((err) => {
    if (ac.signal.aborted) return;
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`socket mode ended: ${errMsg}`);
  });

  return {
    port: boundPort,
    url,
    hub,
    close: async () => {
      opts.signal?.removeEventListener('abort', onAbort);
      ac.abort();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await socketModeDone.catch(() => undefined);
    },
  };
}
