import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSlackRelayClient } from './relay-client.js';
import type { SlackWebSocket } from './socket-mode.js';

function fakeRelayWs() {
  const sent: string[] = [];
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
  return { FakeWs, sent, listeners };
}

const workspace = {
  teamId: 'T1',
  userId: 'U1',
  botToken: 'xoxb-bot',
  userToken: 'xoxp-user',
};

describe('runSlackRelayClient keepalive', () => {
  const controllers: AbortController[] = [];

  afterEach(() => {
    for (const ac of controllers.splice(0)) ac.abort();
  });

  it('registers then pings; unanswered ping reconnects', async () => {
    const { FakeWs, sent, listeners } = fakeRelayWs();
    const logs: string[] = [];
    const ac = new AbortController();
    controllers.push(ac);
    const done = runSlackRelayClient({
      url: 'wss://relay.example/slack/desktop',
      deviceId: 'dev1',
      deviceLabel: 'Work',
      workspaces: [workspace],
      signal: ac.signal,
      pingIntervalMs: 60_000,
      pongTimeoutMs: 40,
      WebSocketImpl: FakeWs,
      onLog: (line) => logs.push(line),
      onEvent: () => undefined,
    });
    await vi.waitFor(() => {
      expect(sent.some((row) => row.includes('"type":"register"'))).toBe(true);
      expect(sent.some((row) => row.includes('"type":"ping"'))).toBe(true);
    });
    expect(listeners.get('open')?.length).toBeGreaterThan(0);
    await vi.waitFor(() => {
      expect(logs.some((line) => line.includes('ping timeout'))).toBe(true);
    });
    ac.abort();
    await done;
  });

  it('stays up when the relay answers pong', async () => {
    const { FakeWs, sent, listeners } = fakeRelayWs();
    const logs: string[] = [];
    const ac = new AbortController();
    controllers.push(ac);
    const done = runSlackRelayClient({
      url: 'wss://relay.example/slack/desktop',
      deviceId: 'dev1',
      deviceLabel: 'Work',
      workspaces: [workspace],
      signal: ac.signal,
      pingIntervalMs: 60_000,
      pongTimeoutMs: 50,
      WebSocketImpl: FakeWs,
      onLog: (line) => logs.push(line),
      onEvent: () => undefined,
    });
    await vi.waitFor(() => {
      expect(sent.some((row) => row.includes('"type":"ping"'))).toBe(true);
      expect(listeners.get('message')?.length).toBeGreaterThan(0);
    });
    listeners.get('message')?.[0]?.({ data: JSON.stringify({ type: 'pong' }) });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(logs.some((line) => line.includes('ping timeout'))).toBe(false);
    expect(logs.some((line) => line.startsWith('Relay connected'))).toBe(true);
    ac.abort();
    await done;
  });
});

describe('runSlackRelayClient claims', () => {
  const controllers: AbortController[] = [];

  afterEach(() => {
    for (const ac of controllers.splice(0)) ac.abort();
  });

  function eventFrame(eventId: string, text: string): string {
    return JSON.stringify({
      type: 'event',
      eventId,
      message: {
        teamId: 'T1',
        userId: 'U1',
        channelId: 'D1',
        ts: `${eventId}.000100`,
        text,
        kind: 'dm',
      },
    });
  }

  function startClient(opts: {
    FakeWs: ReturnType<typeof fakeRelayWs>['FakeWs'];
    onEvent: (msg: { text: string }) => void;
  }) {
    const ac = new AbortController();
    controllers.push(ac);
    const done = runSlackRelayClient({
      url: 'wss://relay.example/slack/desktop',
      deviceId: 'dev1',
      deviceLabel: 'Work',
      workspaces: [workspace],
      signal: ac.signal,
      pingIntervalMs: 60_000,
      pongTimeoutMs: 60_000,
      claimFallbackMs: 30,
      WebSocketImpl: opts.FakeWs,
      onEvent: opts.onEvent,
    });
    return { ac, done };
  }

  it('handles unanswered claims after the fallback delay (legacy relay)', async () => {
    const { FakeWs, sent, listeners } = fakeRelayWs();
    const handled: string[] = [];
    const { ac, done } = startClient({
      FakeWs,
      onEvent: (msg) => {
        handled.push(msg.text);
      },
    });
    await vi.waitFor(() => {
      expect(listeners.get('message')?.length).toBeGreaterThan(0);
    });
    listeners.get('message')?.[0]?.({ data: eventFrame('e1', 'hello') });
    await vi.waitFor(() => {
      expect(sent.some((row) => row.includes('"type":"claim"'))).toBe(true);
      expect(handled).toEqual(['hello']);
    });
    ac.abort();
    await done;
  });

  it('does not double-handle when claim_denied arrives after the fallback delay', async () => {
    const { FakeWs, listeners } = fakeRelayWs();
    const handled: string[] = [];
    const { ac, done } = startClient({
      FakeWs,
      onEvent: (msg) => {
        handled.push(msg.text);
      },
    });
    await vi.waitFor(() => {
      expect(listeners.get('message')?.length).toBeGreaterThan(0);
    });
    const emit = (data: string) => listeners.get('message')?.[0]?.({ data });

    // Relay proves it answers claims: this Mac wins the first event.
    emit(eventFrame('e1', 'first'));
    emit(JSON.stringify({ type: 'claim_ok', eventId: 'e1' }));
    await vi.waitFor(() => {
      expect(handled).toEqual(['first']);
    });

    // Another Mac wins the second event; claim_denied arrives after the
    // (now disarmed) fallback delay would have fired.
    emit(eventFrame('e2', 'second'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    emit(JSON.stringify({ type: 'claim_denied', eventId: 'e2' }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(handled).toEqual(['first']);
    ac.abort();
    await done;
  });

  it('claim_denied on the first event disarms the pending fallback', async () => {
    const { FakeWs, listeners } = fakeRelayWs();
    const handled: string[] = [];
    const { ac, done } = startClient({
      FakeWs,
      onEvent: (msg) => {
        handled.push(msg.text);
      },
    });
    await vi.waitFor(() => {
      expect(listeners.get('message')?.length).toBeGreaterThan(0);
    });
    const emit = (data: string) => listeners.get('message')?.[0]?.({ data });
    emit(eventFrame('e1', 'other mac won'));
    emit(JSON.stringify({ type: 'claim_denied', eventId: 'e1' }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(handled).toEqual([]);
    ac.abort();
    await done;
  });
});
