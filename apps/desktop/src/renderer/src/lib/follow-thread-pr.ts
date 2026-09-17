import { githubPullNumber } from './pr-activity';

/** Live GitHub fields the right-sidebar pill / primary git action read. */
export type SidebarPrMeta = {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  title: string;
  baseRefName: string;
  reviewDecision: string | null;
  isInMergeQueue: boolean;
  mergeable: string | null;
  mergeStateStatus: string | null;
};

function samePrUrl(a: string, b: string): boolean {
  if (a === b) return true;
  const na = githubPullNumber(a);
  const nb = githubPullNumber(b);
  return Boolean(na && nb && na === nb);
}

/**
 * When the PR connected to a worktree changes (new URL or lifecycle), drop or
 * patch cached GraphQL meta so the right-sidebar pill and left-sidebar hover
 * card cannot keep showing the previous PR's number / draft / merged status.
 */
export function followThreadPrMeta(
  prev: SidebarPrMeta | null,
  thread: {
    prUrl?: string | null;
    prState?: string | null;
    prIsDraft?: boolean;
  },
): SidebarPrMeta | null {
  const url = thread.prUrl?.trim() || '';
  if (!url) return null;

  const state = thread.prState?.trim() || '';
  const isDraft = Boolean(thread.prIsDraft);
  const samePr = Boolean(prev && samePrUrl(prev.url, url));

  if (samePr && prev) {
    const nextState = state || prev.state;
    if (prev.url === url && prev.state === nextState && prev.isDraft === isDraft) {
      return prev;
    }
    return { ...prev, url, state: nextState, isDraft };
  }

  const num = Number(githubPullNumber(url) ?? 0);
  return {
    number: Number.isFinite(num) && num > 0 ? num : 0,
    url,
    state,
    isDraft,
    title: '',
    baseRefName: '',
    reviewDecision: null,
    isInMergeQueue: false,
    mergeable: null,
    mergeStateStatus: null,
  };
}

/**
 * Left-sidebar hover must not invent "Needs approval" / "Open" from a URL-only
 * stub. Show a status once GitHub fields landed, or when persisted lifecycle
 * is already draft / merged / closed / queued.
 */
export function sidebarPrHasKnownStatus(meta: SidebarPrMeta | null): boolean {
  if (!meta) return false;
  const state = meta.state.trim().toUpperCase();
  if (state === 'MERGED' || state === 'CLOSED') return true;
  if (meta.isDraft || meta.isInMergeQueue) return true;
  return Boolean(
    meta.title ||
      meta.reviewDecision ||
      meta.mergeable ||
      meta.mergeStateStatus,
  );
}
