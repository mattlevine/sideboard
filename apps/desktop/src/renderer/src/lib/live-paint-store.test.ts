import { describe, expect, it, vi } from 'vitest';
import { createLivePaintStore, EMPTY_LIVE_THREAD } from './live-paint-store';

describe('createLivePaintStore', () => {
  it('notifies only the thread that received stream ops', () => {
    const store = createLivePaintStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribeThread('a', a);
    store.subscribeThread('b', b);
    store.apply(
      [
        { kind: 'started', threadId: 'a' },
        {
          kind: 'output',
          threadId: 'a',
          event: { type: 'stdout', data: 'hi' },
        },
      ],
      1,
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(store.getThread('a').output).toBe('hi');
    expect(store.getThread('b')).toBe(EMPTY_LIVE_THREAD);
  });

  it('keeps a stable snapshot when that thread is unchanged', () => {
    const store = createLivePaintStore();
    store.apply(
      [
        { kind: 'started', threadId: 'a' },
        {
          kind: 'output',
          threadId: 'a',
          event: { type: 'stdout', data: 'one' },
        },
      ],
      1,
    );
    const first = store.getThread('a');
    store.apply(
      [
        {
          kind: 'output',
          threadId: 'b',
          event: { type: 'stdout', data: 'other' },
        },
      ],
      2,
    );
    expect(store.getThread('a')).toBe(first);
    expect(store.getThread('b').output).toBe('other');
  });
});
