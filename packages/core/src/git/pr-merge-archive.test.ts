import { describe, expect, it } from 'vitest';
import {
  normalizePrState,
  shouldAutoArchiveOnPrMerge,
} from './pr-merge-archive.js';

describe('normalizePrState', () => {
  it('uppercases and trims', () => {
    expect(normalizePrState(' merged ')).toBe('MERGED');
    expect(normalizePrState(null)).toBe('');
  });
});

describe('shouldAutoArchiveOnPrMerge', () => {
  const base = {
    previousPrState: 'OPEN' as string | null,
    nextPrState: 'MERGED',
    threadStatus: 'idle' as const,
    autoArchiveEnabled: true,
    isGlobal: false,
  };

  it('archives on first transition to MERGED', () => {
    expect(shouldAutoArchiveOnPrMerge(base)).toBe(true);
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, previousPrState: null }),
    ).toBe(true);
  });

  it('does not re-archive when already MERGED', () => {
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, previousPrState: 'MERGED' }),
    ).toBe(false);
  });

  it('respects restore skip flag (Conductor unarchive guard)', () => {
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, skipAutoArchiveOnMerge: true }),
    ).toBe(false);
  });

  it('respects setting off, archived, and global', () => {
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, autoArchiveEnabled: false }),
    ).toBe(false);
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, threadStatus: 'archived' }),
    ).toBe(false);
    expect(shouldAutoArchiveOnPrMerge({ ...base, isGlobal: true })).toBe(false);
  });
});
