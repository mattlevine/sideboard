import { describe, expect, it, vi } from 'vitest';
import {
  inboundFromSocketFrame,
  isSlackStopCommand,
  openSlackSocketUrl,
  parseSlackSocketFrame,
  resolveWebSocket,
  runSlackSocketMode,
  stripSlackMentions,
  type SlackWebSocket,
} from './socket-mode.js';

function dmFrame(overrides: Record<string, unknown> = {}) {
  return {
    type: 'events_api',
    envelope_id: 'env1',
    payload: {
      team_id: 'T1',
      event: {
        type: 'message',
        channel: 'D1',
        channel_type: 'im',
        user: 'U1',
        text: 'fix CI',
        ts: '111.222',
        ...overrides,
      },
    },
  };
}

describe('Slack Socket Mode frames', () => {
  it('parses JSON frames and ignores junk', () => {
    expect(parseSlackSocketFrame('{"type":"hello"}')).toEqual({ type: 'hello' });
    expect(parseSlackSocketFrame('not json')).toBeNull();
  });

  it('accepts DMs and @mentions, skips bots/edits/other channels', () => {
    expect(inboundFromSocketFrame(dmFrame())).toEqual({
      teamId: 'T1',
      channelId: 'D1',
      ts: '111.222',
      threadTs: undefined,
      userId: 'U1',
      text: 'fix CI',
      kind: 'dm',
    });
    expect(
      inboundFromSocketFrame({
        type: 'events_api',
        payload: {
          team_id: 'T1',
          event: {
            type: 'app_mention',
            channel: 'C1',
            user: 'U2',
            text: '<@Ubot> ship it',
            ts: '3.4',
            thread_ts: '1.2',
          },
        },
      }),
    ).toEqual({
      teamId: 'T1',
      channelId: 'C1',
      ts: '3.4',
      threadTs: '1.2',
      userId: 'U2',
      text: 'ship it',
      kind: 'mention',
    });
    expect(inboundFromSocketFrame(dmFrame({ bot_id: 'B1' }))).toBeNull();
    expect(inboundFromSocketFrame(dmFrame({ subtype: 'message_changed' }))).toBeNull();
    expect(inboundFromSocketFrame(dmFrame({ channel_type: 'channel' }))).toBeNull();
    expect(
      inboundFromSocketFrame(dmFrame({ channel_type: 'mpim', text: 'group dm' })),
    ).toMatchObject({ kind: 'dm', text: 'group dm' });
    expect(
      inboundFromSocketFrame(
        dmFrame({ channel_type: undefined, channel: 'D9', text: 'no type' }),
      ),
    ).toMatchObject({ kind: 'dm', text: 'no type' });
    expect(inboundFromSocketFrame(dmFrame({ text: '<@Ubot>' }))).toBeNull();
  });

  it('strips mentions and recognizes stop', () => {
    expect(stripSlackMentions('<@U123> hello <@U456|bot>')).toBe('hello');
    expect(isSlackStopCommand('stop')).toBe(true);
    expect(isSlackStopCommand('<@Ubot> STOP')).toBe(true);
    expect(isSlackStopCommand('SIDEBOARD_FORCE_STOP')).toBe(true);
    expect(isSlackStopCommand('please stop')).toBe(false);
  });
});

describe('resolveWebSocket', () => {
  it('falls back to ws when global WebSocket is missing', () => {
    const prev = globalThis.WebSocket;
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'WebSocket');
    // @ts-expect-error -- delete for Node/Electron main coverage
    delete globalThis.WebSocket;
    try {
      const Ctor = resolveWebSocket();
      expect(typeof Ctor).toBe('function');
    } finally {
      if (had) globalThis.WebSocket = prev;
    }
  });
});
describe('openSlackSocketUrl', () => {
  it('rejects non-xapp tokens', async () => {
    await expect(openSlackSocketUrl('xoxb-bot')).rejects.toThrow(/app-level token/);
  });

  it('returns the websocket URL from apps.connections.open', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, url: 'wss://wss-primary.slack.com/link' }),
    })) as unknown as typeof fetch;
    await expect(openSlackSocketUrl('xapp-1', fetchImpl)).resolves.toBe(
      'wss://wss-primary.slack.com/link',
    );
  });
});

describe('runSlackSocketMode', () => {
  it('acks envelopes and dispatches inbound DMs', async () => {
    const sent: string[] = [];
    const events: Array<{ kind: string; text: string }> = [];
    const listeners = new Map<string, Array<(ev: { data?: unknown }) => void>>();
    class FakeWs implements SlackWebSocket {
      constructor(public url: string) {}
      send(data: string) {
        sent.push(data);
      }
      close() {
        listeners.get('close')?.forEach((fn) => fn({}));
      }
      addEventListener(
        type: 'open' | 'message' | 'error' | 'close',
        listener: (ev: { data?: unknown }) => void,
      ) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
        if (type === 'open') queueMicrotask(() => listener({}));
      }
    }

    const ac = new AbortController();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, url: 'wss://example/socket' }),
    })) as unknown as typeof fetch;

    const done = runSlackSocketMode({
      appToken: 'xapp-1',
      signal: ac.signal,
      fetchImpl,
      WebSocketImpl: FakeWs,
      onEvent: (msg) => {
        events.push({ kind: msg.kind, text: msg.text });
        ac.abort();
      },
    });

    await vi.waitFor(() => expect(listeners.get('message')?.length).toBeGreaterThan(0));
    listeners.get('message')?.[0]?.({
      data: JSON.stringify(dmFrame({ text: 'hello from slack' })),
    });
    await done;
    expect(sent).toEqual([JSON.stringify({ envelope_id: 'env1' })]);
    expect(events).toEqual([{ kind: 'dm', text: 'hello from slack' }]);
  });
});
