import { describe, expect, it, vi } from 'vitest';
import {
  XTERM_SCROLLBACK_CHUNK,
  stripScrollbackOverlap,
  writeXtermScrollback,
} from './xterm-scrollback-write';

describe('stripScrollbackOverlap', () => {
  it('returns live when snapshot is empty', () => {
    expect(stripScrollbackOverlap('', 'abc')).toBe('abc');
  });

  it('drops a live prefix that is already a snapshot suffix', () => {
    expect(stripScrollbackOverlap('hello world', 'world!')).toBe('!');
  });

  it('keeps post-snapshot live bytes only', () => {
    expect(stripScrollbackOverlap('prompt> ', 'prompt> ls\n')).toBe('ls\n');
  });

  it('returns full live when there is no overlap', () => {
    expect(stripScrollbackOverlap('aaaa', 'bbbb')).toBe('bbbb');
  });
});

describe('writeXtermScrollback', () => {
  it('no-ops empty data', async () => {
    const write = vi.fn();
    await writeXtermScrollback(write, '');
    expect(write).not.toHaveBeenCalled();
  });

  it('writes small payloads in one call', async () => {
    const chunks: string[] = [];
    await writeXtermScrollback((data, next) => {
      chunks.push(data);
      next?.();
    }, 'hello');
    expect(chunks).toEqual(['hello']);
  });

  it('chunks large payloads and yields between slices', async () => {
    const data = 'x'.repeat(XTERM_SCROLLBACK_CHUNK * 2 + 10);
    const chunks: string[] = [];
    const schedules: Array<() => void> = [];
    await writeXtermScrollback(
      (slice, next) => {
        chunks.push(slice);
        next?.();
      },
      data,
      {
        schedule: (cb) => {
          schedules.push(cb);
          cb();
        },
      },
    );
    expect(chunks).toEqual([
      'x'.repeat(XTERM_SCROLLBACK_CHUNK),
      'x'.repeat(XTERM_SCROLLBACK_CHUNK),
      'x'.repeat(10),
    ]);
    expect(schedules).toHaveLength(2);
  });

  it('stops when cancelled between chunks', async () => {
    const data = 'y'.repeat(XTERM_SCROLLBACK_CHUNK + 5);
    const chunks: string[] = [];
    let cancelled = false;
    await writeXtermScrollback(
      (slice, next) => {
        chunks.push(slice);
        cancelled = true;
        next?.();
      },
      data,
      {
        isCancelled: () => cancelled,
        schedule: (cb) => cb(),
      },
    );
    expect(chunks).toEqual(['y'.repeat(XTERM_SCROLLBACK_CHUNK)]);
  });
});
