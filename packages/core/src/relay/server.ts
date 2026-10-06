import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  parseSlackOAuthCallbackUrl,
  parseSlackOAuthResultUrl,
  slackOAuthHtmlPage,
  escapeHtml,
  SLACK_RELAY_DESKTOP_PATH,
} from '../slack/oauth-redirect.js';
import {
  exchangeSlackOAuthCode,
  SlackOAuthPendingStore,
  slackOAuthRelayClientId,
  slackOAuthRelayRedirectUri,
} from '../slack/oauth-exchange.js';
import { runSlackSocketMode } from '../slack/socket-mode.js';
import {
  parseSlackRelayClientMessage,
  SLACK_RELAY_PING_INTERVAL_MS,
} from '../slack/relay-protocol.js';
import { SlackRelayHub } from '../slack/relay-hub.js';
import { hostnameAllowed, requestHostname, tryServeStatic } from './static.js';
import { RemoteHub } from '../remote/hub.js';
import { REMOTE_PING_INTERVAL_MS, REMOTE_RELAY_PATH } from '../remote/protocol.js';
import {
  ableTimeOAuthBouncePage,
  ableTimeOAuthLocalBounceUrl,
} from '../integrations/abletime-oauth.js';

export interface RelayServerOptions {
  /** Required unless skipSocketMode. Phone remote does not use this token. */
  appToken?: string;
  /** OAuth client secret — from Fly `SIDEBOARD_SLACK_CLIENT_SECRET`. Never ship in the DMG. */
  clientSecret?: string;
  clientId?: string;
  oauthRedirectUri?: string;
  port?: number;
  host?: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  fetchImpl?: typeof fetch;
  /** Injected hub (tests). */
  hub?: SlackRelayHub;
  /** Skip Slack Socket Mode (tests). */
  skipSocketMode?: boolean;
  /** Optional marketing site root (Fly: `/app/site`). `/health` stays JSON. */
  staticRoot?: string;
  /** Hostnames that get the marketing site (e.g. `www.sideboard.cloud`). Empty = any host. */
  staticHosts?: string[];
  /** Apex (or aliases) that 301 to `canonicalSiteHost`. */
  redirectHosts?: string[];
  /** Canonical public site host (default `www.sideboard.cloud`). */
  canonicalSiteHost?: string;
}

export interface RelayServerHandle {
  port: number;
  url: string;
  hub: SlackRelayHub;
  close: () => Promise<void>;
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(slackOAuthHtmlPage(title, body));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Protocol ping so Fly and NAT keep an idle WebSocket. */
export function startRelaySocketPing(
  ws: {
    readyState: number;
    OPEN: number;
    ping: () => void;
    on: (event: 'close' | 'error', fn: () => void) => void;
  },
  intervalMs: number,
): () => void {
  const ping = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(ping);
      return;
    }
    try {
      ws.ping();
    } catch {
      clearInterval(ping);
    }
  }, intervalMs);
  const stop = () => clearInterval(ping);
  ws.on('close', stop);
  ws.on('error', stop);
  return stop;
}

/**
 * Hosted relay. Phone and Mac use `/remote`. The marketing site and AbleTime
 * OAuth bounce are served here too. Slack desktops use `/slack/desktop`, and
 * Socket Mode runs only when an xapp- token is set.
 * GET /slack/callback exchanges Slack OAuth (client secret stays here).
 */
export async function startRelayServer(
  opts: RelayServerOptions,
): Promise<RelayServerHandle> {
  const log = opts.onLog ?? console.log;
  const appToken = opts.appToken?.trim() ?? '';
  if (!opts.skipSocketMode && !appToken.startsWith('xapp-')) {
    throw new Error('SIDEBOARD_SLACK_APP_TOKEN must be an xapp-… app-level token');
  }

  const clientId = (opts.clientId ?? slackOAuthRelayClientId()).trim();
  const clientSecret = (opts.clientSecret ?? process.env.SIDEBOARD_SLACK_CLIENT_SECRET ?? '').trim();
  const redirectUri = (opts.oauthRedirectUri ?? slackOAuthRelayRedirectUri()).trim();
  const pending = new SlackOAuthPendingStore();

  const hub =
    opts.hub ??
    new SlackRelayHub({
      fetchImpl: opts.fetchImpl ?? fetch,
      onLog: log,
    });
  const remoteHub = new RemoteHub();

  const handleCallback = async (reqUrl: string, res: ServerResponse): Promise<boolean> => {
    const url = parseSlackOAuthCallbackUrl(reqUrl);
    if (!url) return false;
    const error = url.searchParams.get('error')?.trim();
    const state = url.searchParams.get('state')?.trim() ?? '';
    const code = url.searchParams.get('code')?.trim() ?? '';
    if (error) {
      if (state) pending.put(state, { ok: false, error: `Slack OAuth: ${error}` });
      sendHtml(
        res,
        400,
        'Slack',
        `<h1>Authorization cancelled</h1><p>${escapeHtml(error)}</p>`,
      );
      return true;
    }
    if (!state || !code) {
      sendHtml(res, 400, 'Slack', '<h1>Invalid callback</h1><p>State or code missing.</p>');
      return true;
    }
    if (!clientSecret) {
      pending.put(state, {
        ok: false,
        error: 'Relay is missing SIDEBOARD_SLACK_CLIENT_SECRET',
      });
      sendHtml(
        res,
        500,
        'Slack',
        '<h1>Relay misconfigured</h1><p>OAuth client secret is not set on the relay.</p>',
      );
      return true;
    }
    try {
      const payload = await exchangeSlackOAuthCode({
        clientId,
        clientSecret,
        code,
        redirectUri,
        fetchImpl: opts.fetchImpl,
      });
      pending.put(state, { ok: true, payload });
      if (payload.bot_token) {
        hub.rememberBot(payload.team_id, payload.bot_token);
        if (payload.user_id) {
          void hub.handleAppHomeOpened(payload.team_id, payload.user_id);
        }
      }
      sendHtml(
        res,
        200,
        'Slack connected',
        '<h1>Slack workspace connected</h1><p>Open <strong>Sideboard → Settings → Remote → Slack</strong>. Confirm Relay connected, name this Mac, then DM @Sideboard.</p><p>Need the app? <a href="https://www.sideboard.cloud/slack/">Download Sideboard</a>.</p>',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pending.put(state, { ok: false, error: message });
      sendHtml(res, 400, 'Slack', `<h1>Could not connect Slack</h1><p>${escapeHtml(message)}</p>`);
    }
    return true;
  };

  const handleResult = (reqUrl: string, res: ServerResponse): boolean => {
    const url = parseSlackOAuthResultUrl(reqUrl);
    if (!url) return false;
    const state = url.searchParams.get('state')?.trim() ?? '';
    const value = pending.take(state);
    if (!value) {
      sendJson(res, 404, { ok: false, error: 'pending' });
      return true;
    }
    if (!value.ok) {
      sendJson(res, 400, { ok: false, error: value.error });
      return true;
    }
    sendJson(res, 200, { ok: true, ...value.payload });
    return true;
  };

  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      const reqUrl = req.url || '/';
      if (await handleCallback(reqUrl, res)) return;
      if (handleResult(reqUrl, res)) return;
      const ableTimeBounce = ableTimeOAuthLocalBounceUrl(reqUrl);
      if (ableTimeBounce && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          Refresh: `0;url=${ableTimeBounce}`,
        });
        res.end(req.method === 'HEAD' ? '' : ableTimeOAuthBouncePage(ableTimeBounce));
        return;
      }
      if (req.url === '/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'sideboard-relay',
          sessions: hub.listSessions().length,
          oauth: Boolean(clientSecret),
        });
        return;
      }
      const hostname = requestHostname(req);
      const canonical = (opts.canonicalSiteHost ?? 'www.sideboard.cloud').toLowerCase();
      if (opts.redirectHosts?.includes(hostname) && hostname !== canonical) {
        res.writeHead(301, { Location: `https://${canonical}${reqUrl}` });
        res.end();
        return;
      }
      if (
        opts.staticRoot &&
        hostnameAllowed(hostname, opts.staticHosts) &&
        (await tryServeStatic(req, res, opts.staticRoot))
      ) {
        return;
      }
      if (req.url === '/') {
        sendJson(res, 200, {
          ok: true,
          service: 'sideboard-relay',
          sessions: hub.listSessions().length,
          oauth: Boolean(clientSecret),
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    })().catch((err) => {
      log(`http error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal error');
      }
    });
  });

  // Two WebSocketServers on one HTTP server cannot share `upgrade`: the first
  // path mismatch aborts the socket with 400, so /remote never connects.
  const wss = new WebSocketServer({ noServer: true });
  const remoteWss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const target =
      pathname === SLACK_RELAY_DESKTOP_PATH
        ? wss
        : pathname === REMOTE_RELAY_PATH
          ? remoteWss
          : null;
    if (!target) {
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => {
      target.emit('connection', ws, req);
    });
  });
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
    startRelaySocketPing(ws, SLACK_RELAY_PING_INTERVAL_MS);
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

  remoteWss.on('connection', (ws: WebSocket) => {
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
    startRelaySocketPing(ws, REMOTE_PING_INTERVAL_MS);
    log('remote client connected');
    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      remoteHub.handleClientMessage(socket, raw);
    });
    ws.on('close', () => remoteHub.detachSocket(socket));
    ws.on('error', () => remoteHub.detachSocket(socket));
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
  const url = `ws://${host === '0.0.0.0' ? '127.0.0.1' : host}:${boundPort}${SLACK_RELAY_DESKTOP_PATH}`;
  log(`relay listening on ${url}`);

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const socketModeDone = opts.skipSocketMode
    ? Promise.resolve()
    : runSlackSocketMode({
        appToken,
        signal: ac.signal,
        fetchImpl: opts.fetchImpl,
        onLog: (line) => log(line),
        onEvent: (msg) => {
          hub.routeEvent(msg);
        },
        onLifecycle: (event) => {
          if (event.kind === 'app_home_opened') {
            void hub.handleAppHomeOpened(event.teamId, event.userId);
            return;
          }
          hub.uninstallTeam(event.teamId);
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
      await new Promise<void>((resolve) => {
        remoteWss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await socketModeDone.catch(() => undefined);
    },
  };
}
