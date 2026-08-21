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
