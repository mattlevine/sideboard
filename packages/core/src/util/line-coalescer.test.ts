import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineCoalescer } from './line-coalescer.js';

describe('createLineCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins lines that arrive within one tick into a single chunk', () => {
    const chunks: string[] = [];
    const c = createLineCoalescer((chunk) => chunks.push(chunk), { delayMs: 50 });
    c.push('a');
    c.push('b');
    c.push('c');
    expect(chunks).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(chunks).toEqual(['a\nb\nc']);
  });

  it('flushes early once maxLines is reached', () => {
    const chunks: string[] = [];
    const c = createLineCoalescer((chunk) => chunks.push(chunk), { delayMs: 1_000, maxLines: 2 });
    c.push('a');
    c.push('b');
    expect(chunks).toEqual(['a\nb']);
    c.push('c');
    vi.advanceTimersByTime(1_000);
    expect(chunks).toEqual(['a\nb', 'c']);
  });

  it('flush() drains synchronously and is a no-op when empty', () => {
    const chunks: string[] = [];
    const c = createLineCoalescer((chunk) => chunks.push(chunk));
    c.flush();
    c.push('tail');
    c.flush();
    expect(chunks).toEqual(['tail']);
    vi.runAllTimers();
    expect(chunks).toEqual(['tail']);
  });
});
