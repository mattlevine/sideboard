import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRelaySocketPing } from './server.js';

describe('startRelaySocketPing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings an open remote socket until it closes', () => {
    vi.useFakeTimers();
    const pings: number[] = [];
    const listeners = new Map<string, Array<() => void>>();
    const ws = {
      readyState: 1,
      OPEN: 1,
      ping: () => pings.push(1),
      on: (event: 'close' | 'error', fn: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(fn);
        listeners.set(event, list);
      },
    };
    startRelaySocketPing(ws, 20_000);
    expect(pings).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(pings).toEqual([1]);
    vi.advanceTimersByTime(20_000);
    expect(pings).toEqual([1, 1]);
    for (const fn of listeners.get('close') ?? []) fn();
    vi.advanceTimersByTime(20_000);
    expect(pings).toEqual([1, 1]);
  });
});
