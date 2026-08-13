import { WebSocket as WsWebSocket } from 'ws';
import { SlackApiError } from './api.js';

/** Minimal WebSocket surface so tests can inject a fake without DOM lib types. */
export interface SlackWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (ev: { data?: unknown }) => void,
  ): void;
}

export type SlackWebSocketCtor = new (url: string) => SlackWebSocket;

export interface SlackSocketFrame {
  type?: string;
  envelope_id?: string;
  reason?: string;
  payload?: {
    team_id?: string;
    event?: SlackSocketEvent;
  };
}

export interface SlackSocketEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
}

export interface SlackInboundMessage {
  teamId: string;
  channelId: string;
  ts: string;
  threadTs?: string;
  userId?: string;
  text: string;
  kind: 'dm' | 'mention';
}

export interface SlackSocketModeOptions {
  appToken: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onEvent: (msg: SlackInboundMessage) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: SlackWebSocketCtor;
}

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export function stripSlackMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function isSlackStopCommand(text: string): boolean {
  const t = stripSlackMentions(text).toLowerCase();
  return t === 'stop' || t === 'sideboard_force_stop';
}

export function parseSlackSocketFrame(raw: string): SlackSocketFrame | null {
  try {
    const parsed = JSON.parse(raw) as SlackSocketFrame;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * DMs (`message` + `channel_type=im`) and `@mentions`. Skip bots, edits, empty text.
 */
export function inboundFromSocketFrame(
  frame: SlackSocketFrame,
): SlackInboundMessage | null {
  if (frame.type !== 'events_api') return null;
  const event = frame.payload?.event;
  if (!event) return null;
  if (event.bot_id) return null;
  if (event.subtype) return null;
  const channelId = event.channel?.trim();
  const ts = event.ts?.trim();
  if (!channelId || !ts) return null;
  const rawText = event.text?.trim() ?? '';
  const text = stripSlackMentions(rawText);
  if (!text) return null;

  const teamId = (frame.payload?.team_id || event.team || '').trim();
  if (!teamId) return null;

  const isDm =
    event.type === 'message' &&
    (event.channel_type === 'im' ||
      event.channel_type === 'mpim' ||
      (!event.channel_type && channelId.startsWith('D')));
  const isMention = event.type === 'app_mention';
  if (!isDm && !isMention) return null;

  return {
    teamId,
    channelId,
    ts,
    threadTs: event.thread_ts?.trim() || undefined,
    userId: event.user?.trim(),
    text,
    kind: isMention ? 'mention' : 'dm',
  };
}

export async function openSlackSocketUrl(
  appToken: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const token = appToken.trim();
  if (!token.startsWith('xapp-')) {
    throw new Error(
      'Socket Mode needs an app-level token (xapp-…) with connections:write. Create one on the Slack app → Basic Information → App-Level Tokens.',
    );
  }
  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string; url?: string };
  if (!json.ok) {
    throw new SlackApiError('apps.connections.open', json.error || `HTTP ${res.status}`);
  }
  const url = json.url?.trim();
  if (!url) throw new Error('Slack apps.connections.open did not return a WebSocket URL');
  return url;
}

function messageToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data ?? '');
}

function nodeWebSocketCtor(): SlackWebSocketCtor {
  return class NodeSlackWebSocket implements SlackWebSocket {
    private readonly socket: WsWebSocket;
    constructor(url: string) {
      this.socket = new WsWebSocket(url);
    }
    send(data: string) {
      this.socket.send(data);
    }
    close(code?: number, reason?: string) {
      this.socket.close(code, reason);
    }
    addEventListener(
      type: 'open' | 'message' | 'error' | 'close',
      listener: (ev: { data?: unknown }) => void,
    ) {
      if (type === 'message') {
        this.socket.on('message', (data) => listener({ data: messageToString(data) }));
        return;
      }
      this.socket.on(type, () => listener({}));
    }
  };
}

export function resolveWebSocket(ctor?: SlackWebSocketCtor): SlackWebSocketCtor {
  if (ctor) return ctor;
  const globalWs = (globalThis as { WebSocket?: SlackWebSocketCtor }).WebSocket;
  if (globalWs) return globalWs;
  return nodeWebSocketCtor();
}

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

/**
 * Connect to Slack Socket Mode and dispatch inbound DMs / @mentions.
 * Acks envelopes immediately, then runs `onEvent`. Reconnects until aborted.
 */
export async function runSlackSocketMode(
  opts: SlackSocketModeOptions,
): Promise<void> {
  const log = opts.onLog ?? (() => undefined);
  const Ws = resolveWebSocket(opts.WebSocketImpl);
  let backoff = BACKOFF_START_MS;

  while (!opts.signal?.aborted) {
    let ws: SlackWebSocket | null = null;
    try {
      const url = await openSlackSocketUrl(opts.appToken, opts.fetchImpl);
      ws = new Ws(url);
      const session = connectSession(ws, opts, log);
      backoff = BACKOFF_START_MS;
      await session;
    } catch (err) {
      if (opts.signal?.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'aborted') return;
      log(`socket error: ${msg}`);
    } finally {
      try {
        ws?.close();
      } catch {
        // ignore
      }
    }
    if (opts.signal?.aborted) return;
    log(`reconnect in ${Math.round(backoff / 1000)}s`);
    try {
      await wait(backoff, opts.signal);
    } catch {
      return;
    }
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }
}

function connectSession(
  ws: SlackWebSocket,
  opts: SlackSocketModeOptions,
  log: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
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

    ws.addEventListener('open', () => {
      log('Socket Mode connected');
    });
    ws.addEventListener('error', () => {
      finish(new Error('WebSocket error'));
    });
    ws.addEventListener('close', () => {
      finish();
    });
    ws.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
      const frame = parseSlackSocketFrame(raw);
      if (!frame) return;
      if (frame.envelope_id) {
        try {
          ws.send(JSON.stringify({ envelope_id: frame.envelope_id }));
        } catch {
          // ignore
        }
      }
      if (frame.type === 'hello') {
        log('Socket Mode hello');
        return;
      }
      if (frame.type === 'disconnect') {
        log(`socket disconnect: ${frame.reason || 'refresh'}`);
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }
      const inbound = inboundFromSocketFrame(frame);
      if (!inbound) return;
      void Promise.resolve(opts.onEvent(inbound)).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(`event error: ${msg}`);
      });
    });
  });
}
