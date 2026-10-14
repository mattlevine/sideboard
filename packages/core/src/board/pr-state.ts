import type { Thread } from '../types/thread.js';

export function isOpenPrState(
  prUrl: string | null | undefined,
  prState: string | null | undefined,
): boolean {
  if (!prUrl?.trim()) return false;
  const state = (prState ?? 'OPEN').trim().toUpperCase();
  return state !== 'MERGED' && state !== 'CLOSED';
}

export function isMergedPrState(
  prUrl: string | null | undefined,
  prState: string | null | undefined,
): boolean {
  if (!prUrl?.trim()) return false;
  return (prState ?? '').trim().toUpperCase() === 'MERGED';
}

/** Open, published pull request whose GitHub review decision is approved. */
export function isApprovedOpenPr(
  thread: Pick<Thread, 'prUrl' | 'prState' | 'prIsDraft' | 'prReviewDecision'>,
): boolean {
  if (!isOpenPrState(thread.prUrl, thread.prState) || thread.prIsDraft) return false;
  return (thread.prReviewDecision ?? '').trim().toUpperCase() === 'APPROVED';
}
