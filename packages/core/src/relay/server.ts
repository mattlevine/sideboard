import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { SLACK_RELAY_DESKTOP_PATH } from '../slack/oauth-redirect.js';
import {
  SlackOAuthPendingStore,
  slackOAuthRelayClientId,
  slackOAuthRelayRedirectUri,
} from '../slack/oauth-exchange.js';
import { SlackEventDeduper } from '../slack/events-api.js';
import { parseSlackTokenKey } from '../slack/secret-box.js';
import { handleSlackHttp } from './slack-http.js';
import { SlackAppStore } from './slack-apps.js';
import { SlackListenGrantStore } from './slack-grants.js';
import { MemorySlackListenGrants, type SlackListenGrants } from '../slack/listen-grant.js';
import { runSlackSocketMode } from '../slack/socket-mode.js';
import {
  parseSlackRelayClientMessage,
  SLACK_RELAY_PING_INTERVAL_MS,
} from '../slack/relay-protocol.js';
import { SlackRelayHub } from '../slack/relay-hub.js';
import { CANONICAL_SITE_HOST, serveMarketingSite } from './static.js';
import { RemoteHub } from '../remote/hub.js';
import { REMOTE_PING_INTERVAL_MS, REMOTE_RELAY_PATH } from '../remote/protocol.js';
import { assertRelayAccountsDurable, RelayAccountStore } from './accounts.js';
import { handleRelayAccountHttp, RelayLoginSessions, type RelayOAuthConfig } from './account-oauth.js';
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
  /** Hostnames that may serve site files (e.g. `www.sideboard.build`). Empty = any host. */
  staticHosts?: string[];
  /**
   * Hosts that 301 to `canonicalSiteHost`.
   * A non-canonical name also listed in `staticHosts` 301s the same way, and still
   * serves `/oauth/` so a registered client-metadata URL is not redirected.
   */
  redirectHosts?: string[];
  /** Canonical public site host (default `www.sideboard.build`). */
  canonicalSiteHost?: string;
  /**
   * SQLite file for Sideboard accounts. When set, a Mac must sign in before
   * `host_register`. On Fly this path is a volume mount so deploys keep it.
   */
  accountsPath?: string;
  /** Git-host OAuth clients. Secrets stay on the relay. */
  relayOAuth?: RelayOAuthConfig;
  /** Public origin for OAuth redirects, e.g. `https://relay.sideboard.build`. */
  relayPublicOrigin?: string;
  /** AES key for company Slack secrets. Defaults to SIDEBOARD_SLACK_TOKEN_KEY. */
  slackTokenKey?: string;
}

export interface RelayServerHandle {
  port: number;
  url: string;
  hub: SlackRelayHub;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Client address for the phone-socket cap.
 * Fly’s `Fly-Client-IP` wins. With `SIDEBOARD_RELAY_TRUST_PROXY=1`, the last
 * `X-Forwarded-For` hop is the address the trusted proxy appended.
 */
export function relayClientIp(req: IncomingMessage): string {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.trim()) return fly.trim();
  if (process.env.SIDEBOARD_RELAY_TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const hop = raw
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .pop();
    if (hop) return hop;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Production OAuth redirects need the public https origin. Dev may omit it. */
export function assertRelayPublicOrigin(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.SIDEBOARD_RELAY_PUBLIC_ORIGIN?.trim()) return;
  throw new Error(
    'SIDEBOARD_RELAY_PUBLIC_ORIGIN is required in production. Set it to the public https origin with no path, for example https://relay.example.com.',
  );
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
  assertRelayPublicOrigin();
  const log = opts.onLog ?? console.log;
  const appToken = opts.appToken?.trim() ?? '';
  if (!opts.skipSocketMode && !appToken.startsWith('xapp-')) {
    throw new Error('SIDEBOARD_SLACK_APP_TOKEN must be an xapp-… app-level token');
  }

  const clientId = (opts.clientId ?? slackOAuthRelayClientId()).trim();
  const clientSecret = (opts.clientSecret ?? process.env.SIDEBOARD_SLACK_CLIENT_SECRET ?? '').trim();
  const redirectUri = (opts.oauthRedirectUri ?? slackOAuthRelayRedirectUri()).trim();
  const pending = new SlackOAuthPendingStore();
  let boundPort = 0;

  const hub =
    opts.hub ??
    new SlackRelayHub({
      fetchImpl: opts.fetchImpl ?? fetch,
      onLog: log,
    });
  const accountsPath = opts.accountsPath?.trim() ?? '';
  if (accountsPath) assertRelayAccountsDurable(accountsPath);
  const accountStore = accountsPath ? new RelayAccountStore(accountsPath) : null;
  const slackTokenKey = (opts.slackTokenKey ?? process.env.SIDEBOARD_SLACK_TOKEN_KEY ?? '').trim();
  const slackApps =
    accountsPath && slackTokenKey
      ? new SlackAppStore(accountsPath, parseSlackTokenKey(slackTokenKey))
      : null;
  if (slackApps) {
    for (const row of slackApps.listBots()) hub.rememberBot(row.teamId, row.botToken);
    hub.setBotHooks({
      guardBotUser: (teamId, botUserId) => slackApps.botUserMismatch(teamId, botUserId),
      onBotAccepted: (teamId, botToken, botUserId) => slackApps.saveBot(teamId, botToken, botUserId),
    });
  }
  const listenGrants: SlackListenGrants = accountsPath
    ? new SlackListenGrantStore(accountsPath)
    : new MemorySlackListenGrants();
  hub.setListenGrantVerifier((teamId, userId, grant) => listenGrants.verify(teamId, userId, grant));
  const slackDedupe = new SlackEventDeduper();
  const accountSessions = new RelayLoginSessions();
  const relayOAuth = opts.relayOAuth ?? {};
  const authMarks = new Map<object, () => void>();
  const remoteByIp = new Map<string, number>();
  let remoteSockets = 0;
  const remoteHub = new RemoteHub({
    authorizeHost: accountStore
      ? (input) => {
          const decision = accountStore.authorizeHost(input);
          return decision.ok ? { ok: true } : { ok: false, message: decision.message };
        }
      : undefined,
    phoneSessions: accountStore
      ? {
          find: (sessionToken) => accountStore.findPhoneSession(sessionToken),
          save: (deviceId, sessionToken) => accountStore.savePhoneSession(deviceId, sessionToken),
        }
      : undefined,
    onAuthorized: (socket) => authMarks.get(socket)?.(),
  });

  const publicOrigin = (): string =>
    opts.relayPublicOrigin?.trim() ||
    process.env.SIDEBOARD_RELAY_PUBLIC_ORIGIN?.trim() ||
    `http://127.0.0.1:${boundPort}`;

  const healthBody = () => ({
    ok: true as const,
    service: 'sideboard-relay' as const,
    sessions: hub.listSessions().length,
    oauth: Boolean(clientSecret),
    phoneSockets: remoteSockets,
    accounts: Boolean(accountStore),
    providers: {
      github: Boolean(relayOAuth.github),
      cursor: Boolean(relayOAuth.cursor),
      entire: Boolean(relayOAuth.entire),
    },
  });

  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      const reqUrl = req.url || '/';
      if (
        accountStore &&
        (await handleRelayAccountHttp({
          req,
          res,
          store: accountStore,
          oauth: relayOAuth,
          sessions: accountSessions,
          publicOrigin: publicOrigin(),
          fetchImpl: opts.fetchImpl,
        }))
      ) {
        return;
      }
      if (
        await handleSlackHttp({
          req,
          res,
          reqUrl,
          accounts: accountStore,
          apps: slackApps,
          hub,
          grants: listenGrants,
          pending,
          bakedClientId: clientId,
          bakedClientSecret: clientSecret,
          redirectUri,
          publicOrigin: publicOrigin(),
          fetchImpl: opts.fetchImpl,
          dedupe: slackDedupe,
          log,
        })
      ) {
        return;
      }
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
        sendJson(res, 200, healthBody());
        return;
      }
      if (
        opts.staticRoot &&
        (await serveMarketingSite(req, res, {
          root: opts.staticRoot,
          canonicalHost: opts.canonicalSiteHost ?? CANONICAL_SITE_HOST,
          staticHosts: opts.staticHosts,
          redirectHosts: opts.redirectHosts,
        }))
      ) {
        return;
      }
      if (req.url === '/') {
        sendJson(res, 200, healthBody());
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
    if (target === remoteWss) {
      const ip = relayClientIp(req);
      const count = remoteByIp.get(ip) ?? 0;
      if (count >= 20 || remoteSockets >= 4000) {
        log(`remote rate limit: ${ip} (${count} on this address, ${remoteSockets} open)`);
        target.handleUpgrade(req, socket, head, (ws) => {
          ws.close(4029, 'too many connections');
        });
        return;
      }
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

  remoteWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = relayClientIp(req);
    remoteByIp.set(ip, (remoteByIp.get(ip) ?? 0) + 1);
    remoteSockets += 1;
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
    let released = false;
    const authTimer = accountStore
      ? setTimeout(() => {
          try {
            ws.close(4001, 'sign in required');
          } catch {
            // ignore
          }
        }, 120_000)
      : null;
    authMarks.set(socket, () => {
      if (authTimer) clearTimeout(authTimer);
    });
    const release = () => {
      if (released) return;
      released = true;
      if (authTimer) clearTimeout(authTimer);
      authMarks.delete(socket);
      remoteSockets -= 1;
      const next = (remoteByIp.get(ip) ?? 1) - 1;
      if (next <= 0) remoteByIp.delete(ip);
      else remoteByIp.set(ip, next);
      remoteHub.detachSocket(socket);
    };
    startRelaySocketPing(ws, REMOTE_PING_INTERVAL_MS);
    log('remote client connected');
    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      remoteHub.handleClientMessage(socket, raw);
    });
    ws.on('close', release);
    ws.on('error', release);
  });

  const port = opts.port ?? 0;
  const host = opts.host ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });
  const address = httpServer.address();
  boundPort =
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
          listenGrants.revokeTeam(event.teamId);
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
      slackApps?.close();
      listenGrants.close();
      accountStore?.close();
    },
  };
}
