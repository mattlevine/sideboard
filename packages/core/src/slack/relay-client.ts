import {
  parseSlackRelayServerMessage,
  SLACK_RELAY_PING_INTERVAL_MS,
  SLACK_RELAY_PONG_TIMEOUT_MS,
  type SlackRelayClientMessage,
} from './relay-protocol.js';
import { resolveWebSocket, type SlackInboundMessage, type SlackWebSocketCtor } from './socket-mode.js';
import { lookupPreferPublicDns } from './public-dns.js';
import { WebSocket as WsWebSocket } from 'ws';

export interface SlackRelayRegisterWorkspace {
  teamId: string;
  /** Slack user who owns this Sideboard (OAuth authed_user). */
  userId: string;
  botToken: string;
  userToken: string;
}

export interface SlackRelayClientOptions {
  /** Full WebSocket URL including path, e.g. wss://relay.sideboard.cloud/slack/desktop */
  url: string;
  workspaces: SlackRelayRegisterWorkspace[];
  /** Stable per-Mac destination id. */
  deviceId: string;
  /** Human label shown in relay logs, e.g. Personal / Work. */
  deviceLabel?: string;
  signal?: AbortSignal;
  onEvent: (msg: SlackInboundMessage) => void | Promise<void>;
  onLog?: (line: string) => void;
  WebSocketImpl?: SlackWebSocketCtor;
  /** Tests: override keepalive cadence. */
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
}

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

function send(ws: { send(data: string): void }, msg: SlackRelayClientMessage): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Desktop client: connect to the hosted Slack relay, register this Mac as a
 * destination for the OAuth Slack user, claim inbound events before handling.
 */
export async function runSlackRelayClient(opts: SlackRelayClientOptions): Promise<void> {
  const log = opts.onLog ?? (() => undefined);
  const Ws = opts.WebSocketImpl
    ? resolveWebSocket(opts.WebSocketImpl)
    : (class {
        constructor(url: string) {
          return new WsWebSocket(url, { lookup: lookupPreferPublicDns });
        }
      } as unknown as SlackWebSocketCtor);
  const url = opts.url.trim();
  const deviceId = opts.deviceId.trim();
  if (!url) throw new Error('Slack relay URL is empty');
  if (!deviceId) throw new Error('Slack relay needs a deviceId for this Mac');
  if (opts.workspaces.length === 0) {
    throw new Error(
      'Slack relay needs a connected workspace with bot + user tokens (Add via browser).',
    );
  }

  let backoff = BACKOFF_START_MS;
  while (!opts.signal?.aborted) {
    let ws: InstanceType<SlackWebSocketCtor> | null = null;
    try {
      ws = new Ws(url);
      await connectSession(ws, opts, log);
      backoff = BACKOFF_START_MS;
    } catch (err) {
      if (opts.signal?.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'aborted') return;
      log(`relay error: ${msg}`);
    } finally {
      try {
        ws?.close();
      } catch {
        // ignore
      }
    }
    if (opts.signal?.aborted) return;
    log(`relay reconnect in ${Math.round(backoff / 1000)}s`);
    try {
      await wait(backoff, opts.signal);
    } catch {
      return;
    }
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }
}

function connectSession(
  ws: InstanceType<SlackWebSocketCtor>,
  opts: SlackRelayClientOptions,
  log: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const pending = new Map<string, SlackInboundMessage>();
    const allowedUsers = new Set(
      opts.workspaces.map((w) => `${w.teamId.trim()}:${w.userId.trim()}`),
    );
    const pingMs = opts.pingIntervalMs ?? SLACK_RELAY_PING_INTERVAL_MS;
    const pongMs = opts.pongTimeoutMs ?? SLACK_RELAY_PONG_TIMEOUT_MS;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    const stopKeepalive = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (pongTimer) clearTimeout(pongTimer);
      pingTimer = null;
      pongTimer = null;
    };
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      pending.clear();
      stopKeepalive();
      opts.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      finish();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const armPongTimeout = () => {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = setTimeout(() => {
        log('relay error: ping timeout');
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(new Error('relay ping timeout'));
      }, pongMs);
    };
    const pingOnce = () => {
      try {
        send(ws, { type: 'ping' });
        armPongTimeout();
      } catch (err) {
        finish(err instanceof Error ? err : new Error('relay ping failed'));
      }
    };

    ws.addEventListener('open', () => {
      const label = opts.deviceLabel?.trim() || opts.deviceId.trim();
      log(`Relay connected · ${label}`);
      for (const wsInfo of opts.workspaces) {
        send(ws, {
          type: 'register',
          teamId: wsInfo.teamId,
          userId: wsInfo.userId,
          deviceId: opts.deviceId.trim(),
          deviceLabel: opts.deviceLabel?.trim() || undefined,
          botToken: wsInfo.botToken,
          userToken: wsInfo.userToken,
        });
      }
      pingOnce();
      pingTimer = setInterval(pingOnce, pingMs);
    });
    ws.addEventListener('error', () => {
      finish(new Error('WebSocket error'));
    });
    ws.addEventListener('close', () => {
      finish();
    });
    ws.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
      const msg = parseSlackRelayServerMessage(raw);
      if (!msg) return;
      if (msg.type === 'pong') {
        if (pongTimer) {
          clearTimeout(pongTimer);
          pongTimer = null;
        }
        return;
      }
      if (msg.type === 'error') {
        log(`relay error: ${msg.message}`);
        return;
      }
      if (msg.type === 'registered') {
        log(
          msg.deviceId && msg.deviceId !== 'unknown'
            ? `Relay registered ${msg.teamId}/${msg.userId} · device ${msg.deviceId.slice(0, 8)}…`
            : `Relay registered ${msg.teamId}/${msg.userId}`,
        );
        return;
      }
      if (msg.type === 'event') {
        const key = `${msg.message.teamId.trim()}:${(msg.message.userId ?? '').trim()}`;
        if (!allowedUsers.has(key)) {
          log(`relay skip: event for ${key} not owned by this desktop`);
          return;
        }
        pending.set(msg.eventId, msg.message);
        send(ws, { type: 'claim', eventId: msg.eventId });
        // Older relays never answer claim_ok. Handle the event if no reply arrives.
        const eventId = msg.eventId;
        setTimeout(() => {
          const inbound = pending.get(eventId);
          if (!inbound) return;
          pending.delete(eventId);
          void Promise.resolve(opts.onEvent(inbound)).catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            log(`event error: ${errMsg}`);
          });
        }, 400);
        return;
      }
      if (msg.type === 'claim_denied') {
        pending.delete(msg.eventId);
        return;
      }
      if (msg.type === 'claim_ok') {
        const inbound = pending.get(msg.eventId);
        pending.delete(msg.eventId);
        if (!inbound) return;
        void Promise.resolve(opts.onEvent(inbound)).catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          log(`event error: ${errMsg}`);
        });
      }
    });
  });
}
