import type { ThreadStatus } from '../types/thread.js';

/** Normalize GitHub / gh PR state strings for comparisons. */
export function normalizePrState(state: string | null | undefined): string {
  return (state ?? '').trim().toUpperCase();
}

/**
 * Conductor-style: auto-archive when a PR first becomes MERGED while the
 * workspace is still active. Skip when the user restored a merged workspace
 * (`skipAutoArchiveOnMerge`) so unarchive does not immediately re-archive.
 */
export function shouldAutoArchiveOnPrMerge(opts: {
  previousPrState: string | null | undefined;
  nextPrState: string | null | undefined;
  threadStatus: ThreadStatus;
  skipAutoArchiveOnMerge?: boolean;
  autoArchiveEnabled: boolean;
  isGlobal: boolean;
}): boolean {
  if (!opts.autoArchiveEnabled) return false;
  if (opts.isGlobal) return false;
  if (opts.skipAutoArchiveOnMerge) return false;
  if (opts.threadStatus === 'archived') return false;
  const next = normalizePrState(opts.nextPrState);
  if (next !== 'MERGED') return false;
  return normalizePrState(opts.previousPrState) !== 'MERGED';
}
