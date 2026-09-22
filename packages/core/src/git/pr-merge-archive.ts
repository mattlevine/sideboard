import type { PrMeta, Thread, ThreadStatus } from '../types/thread.js';

/** Normalize GitHub / gh PR state strings for comparisons. */
export function normalizePrState(state: string | null | undefined): string {
  return (state ?? '').trim().toUpperCase();
}

/** Same GitHub pull, ignoring trailing slashes or host/path noise. */
export function samePrIdentity(a?: string | null, b?: string | null): boolean {
  const left = (a ?? '').trim().replace(/\/+$/, '');
  const right = (b ?? '').trim().replace(/\/+$/, '');
  if (!left || !right) return false;
  if (left === right) return true;
  const ln = left.match(/\/pull\/(\d+)/i)?.[1];
  const rn = right.match(/\/pull\/(\d+)/i)?.[1];
  return Boolean(ln && rn && ln === rn);
}

/**
 * After merge-then-continue, the same worktree often attaches a new PR URL.
 * A Run script started for the previous PR is still watching that checkout but
 * is no longer tied to the connected PR — stop it so Start can reattach cleanly.
 * First connect (no previous URL) and same-PR lifecycle updates do not stop.
 */
export function shouldStopRunOnPrRetarget(
  previousPrUrl?: string | null,
  nextPrUrl?: string | null,
): boolean {
  const prev = (previousPrUrl ?? '').trim();
  const next = (nextPrUrl ?? '').trim();
  if (!prev || !next) return false;
  return !samePrIdentity(prev, next);
}

/**
 * Persist GraphQL meta only for the PR this worktree is on right now.
 * A fallback selector (stale persisted URL / create-from sourceRef) must not
 * overwrite a newer `prUrl` on every sibling tab.
 */
export function shouldPersistFetchedPrMeta(opts: {
  metaUrl?: string | null;
  livePrUrl?: string | null;
  headPrUrl?: string | null;
}): boolean {
  const meta = opts.metaUrl?.trim() || '';
  if (!meta) return false;
  const head = opts.headPrUrl?.trim() || '';
  if (head) return samePrIdentity(meta, head);
  const live = opts.livePrUrl?.trim() || '';
  if (live) return samePrIdentity(meta, live);
  return true;
}

function sameLoginList(a?: string[] | null, b?: string[] | null): boolean {
  const left = [...(a ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean).sort();
  const right = [...(b ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean).sort();
  return left.length === right.length && left.every((login, i) => login === right[i]);
}

/**
 * Persistable thread fields when the PR connected to a worktree changes
 * (new URL, draft→ready, merged, …). Applied to every live chat on that checkout.
 */
export function threadPrMetaPatch(
  thread: Pick<
    Thread,
    | 'prUrl'
    | 'prTitle'
    | 'prState'
    | 'prIsDraft'
    | 'prAuthorLogin'
    | 'prReviewerLogins'
    | 'skipAutoArchiveOnMerge'
  >,
  meta: Pick<
    PrMeta,
    'url' | 'title' | 'state' | 'isDraft' | 'authorLogin' | 'reviewerLogins'
  >,
): Partial<Thread> {
  const prevState = normalizePrState(thread.prState);
  const nextState = normalizePrState(meta.state);
  const patch: Partial<Thread> = {};
  if (meta.url && meta.url !== thread.prUrl) patch.prUrl = meta.url;
  if (meta.title && meta.title !== thread.prTitle) patch.prTitle = meta.title;
  if (nextState && nextState !== prevState) patch.prState = nextState;
  const nextDraft =
    Boolean(meta.isDraft) && nextState !== 'MERGED' && nextState !== 'CLOSED';
  if (nextDraft !== Boolean(thread.prIsDraft)) patch.prIsDraft = nextDraft;
  const nextAuthor = meta.authorLogin?.trim() || '';
  if (nextAuthor && nextAuthor !== (thread.prAuthorLogin ?? '').trim()) {
    patch.prAuthorLogin = nextAuthor;
  }
  const nextReviewers = meta.reviewerLogins ?? [];
  if (!sameLoginList(nextReviewers, thread.prReviewerLogins)) {
    patch.prReviewerLogins = nextReviewers;
  }
  if (
    thread.skipAutoArchiveOnMerge &&
    nextState &&
    nextState !== 'MERGED' &&
    nextState !== 'CLOSED'
  ) {
    patch.skipAutoArchiveOnMerge = false;
  }
  return patch;
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
