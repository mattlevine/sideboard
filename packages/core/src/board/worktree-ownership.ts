import type { Thread } from '../types/thread.js';

/**
 * Mine = PRs you authored, or local WIP with no PR.
 * Reviewing = someone else's PR (author known and not you), a create-from-PR
 * checkout, or a PR that requested your review.
 * Viewer login comes from `gh` (`getGitHubStatus().login`) — not a setting.
 */
export type WorktreeOwnership = 'mine' | 'reviewing';

/** Board / sidebar filter. Default `all` shows every worktree. */
export type BoardOwnershipFilter = 'all' | WorktreeOwnership;

export const DEFAULT_BOARD_OWNERSHIP: BoardOwnershipFilter = 'all';

export function normalizeViewerLogin(login: string | null | undefined): string {
  return (login ?? '').trim().toLowerCase();
}

export function loginsInclude(
  logins: string[] | null | undefined,
  viewerLogin: string,
): boolean {
  const me = normalizeViewerLogin(viewerLogin);
  if (!me) return false;
  return (logins ?? []).some((login) => normalizeViewerLogin(login) === me);
}

export function classifyWorktreeOwnership(
  group: Array<
    Pick<Thread, 'prUrl' | 'prAuthorLogin' | 'prReviewerLogins' | 'sourceType'>
  >,
  viewerLogin = '',
): WorktreeOwnership {
  const me = normalizeViewerLogin(viewerLogin);
  if (
    group.some((t) => {
      const author = normalizeViewerLogin(t.prAuthorLogin);
      return Boolean(author && me && author === me);
    })
  ) {
    return 'mine';
  }

  const reviewing = group.some((t) => {
    const author = normalizeViewerLogin(t.prAuthorLogin);
    if (author && me && author !== me) return true;
    // Create-from-PR is reviewing only after we know the viewer — an empty
    // login would otherwise badge every PR checkout as reviewing and hide it
    // from a persisted Mine filter until `gh api user` returns.
    if (t.sourceType === 'pr' && me && (!author || author !== me)) return true;
    if (me && loginsInclude(t.prReviewerLogins, me)) return true;
    return false;
  });
  return reviewing ? 'reviewing' : 'mine';
}

export function worktreeMatchesOwnership(
  group: Array<
    Pick<Thread, 'prUrl' | 'prAuthorLogin' | 'prReviewerLogins' | 'sourceType'>
  >,
  filter: BoardOwnershipFilter,
  viewerLogin = '',
): boolean {
  if (filter === 'all') return true;
  return classifyWorktreeOwnership(group, viewerLogin) === filter;
}
