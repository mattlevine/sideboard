import { classifyPrMergeIssue, mergeStateSuggestsCheckFailure } from '../git/pr-gates.js';
import type { Thread } from '../types/thread.js';
import { isApprovedOpenPr, isMergedPrState, isOpenPrState } from './pr-state.js';
import {
  classifyWorktreeOwnership,
  normalizeViewerLogin,
} from './worktree-ownership.js';

export type WorktreeListBadgeId =
  | 'new'
  | 'draft'
  | 'pending'
  | 'review'
  | 'approved'
  | 'merged';

export type WorktreeListBadge = {
  id: WorktreeListBadgeId;
  label: string;
  title: string;
  mod: string;
  /**
   * Red dot on the status pill. Merge conflicts, failing checks, or changes
   * requested. The title names which.
   */
  conflict?: boolean;
};

export type WorktreeListBadgeThread = Pick<
  Thread,
  | 'prUrl'
  | 'prState'
  | 'prIsDraft'
  | 'prAuthorLogin'
  | 'prReviewerLogins'
  | 'sourceType'
  | 'cowboy'
  | 'prLabels'
  | 'prReviewDecision'
  | 'prMergeable'
  | 'prMergeStateStatus'
  | 'prIsInMergeQueue'
  | 'prChecksFailed'
>;

function labelsInclude(
  labels: string[] | null | undefined,
  name: string,
): boolean {
  const want = name.trim().toLowerCase();
  if (!want) return false;
  return (labels ?? []).some((label) => label.trim().toLowerCase() === want);
}

/**
 * Ready-for-review GitHub label for a repo from Settings → Projects
 * (`reviewLabel`), matching exact or descendant worktree paths.
 */
export function reviewLabelForRepo(
  labelsByRepo: Record<string, string> | null | undefined,
  repoPath: string,
): string {
  const want = repoPath.trim().replace(/\/+$/, '');
  if (!want || !labelsByRepo) return '';
  const direct = labelsByRepo[want]?.trim();
  if (direct) return direct;
  let best = '';
  let bestLen = 0;
  for (const [key, label] of Object.entries(labelsByRepo)) {
    const stored = key.trim().replace(/\/+$/, '');
    const value = label.trim();
    if (!stored || !value) continue;
    if (stored === want || want.startsWith(`${stored}/`)) {
      if (stored.length > bestLen) {
        best = value;
        bestLen = stored.length;
      }
    }
  }
  return best;
}

function groupPrLabels(group: Array<Pick<Thread, 'prLabels'>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const thread of group) {
    for (const label of thread.prLabels ?? []) {
      const key = label.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(label.trim());
    }
  }
  return out;
}

function isClosedPrState(
  prUrl: string | null | undefined,
  prState: string | null | undefined,
): boolean {
  if (!prUrl?.trim()) return false;
  return (prState ?? '').trim().toUpperCase() === 'CLOSED';
}

function listBadge(
  id: WorktreeListBadgeId,
  title: string,
  note?: string,
): WorktreeListBadge {
  return {
    id,
    label: id,
    title: note ? `${title} · ${note}` : title,
    mod: `is-${id}`,
    ...(note ? { conflict: true } : {}),
  };
}

function hasMergeConflict(thread: WorktreeListBadgeThread): boolean {
  if (!isOpenPrState(thread.prUrl, thread.prState)) return false;
  return (
    classifyPrMergeIssue({
      mergeable: thread.prMergeable ?? null,
      mergeStateStatus: thread.prMergeStateStatus ?? null,
      isInMergeQueue: thread.prIsInMergeQueue,
    }) === 'conflicts'
  );
}

/**
 * Why the red dot is on. Open PRs only. Failing checks outrank requested
 * changes. Behind-base is an update, not a dot. The merge queue hides both.
 */
function blockerNote(group: WorktreeListBadgeThread[]): string | undefined {
  const open = group.filter(
    (thread) => isOpenPrState(thread.prUrl, thread.prState) && !thread.prIsInMergeQueue,
  );
  const parts: string[] = [];
  if (
    open.some(
      (thread) =>
        thread.prChecksFailed ||
        mergeStateSuggestsCheckFailure({
          mergeStateStatus: thread.prMergeStateStatus ?? null,
          reviewDecision: thread.prReviewDecision ?? null,
        }),
    )
  ) {
    parts.push('checks failing');
  } else if (
    open.some(
      (thread) =>
        !thread.prIsDraft &&
        (thread.prReviewDecision ?? '').trim().toUpperCase() === 'CHANGES_REQUESTED',
    )
  ) {
    parts.push('changes requested');
  }
  if (open.some(hasMergeConflict)) parts.push('merge conflicts');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Sidebar / phone / board pills for where a checkout is on the path to merge.
 * Cowboy worktrees keep the separate cowboy badge. A closed PR stays unlabeled.
 *
 * New is no pull request. Draft is your draft. Pending is your published PR
 * waiting for review. Review is someone else's open PR, including their drafts.
 * Approved is an open non-draft PR GitHub has approved. Merged is merged.
 * A red dot on that pill means merge conflicts, failing checks, or changes
 * requested. The title says which. There is no second badge.
 *
 * Yours is pending when the project ready-for-review label (Settings →
 * Projects) is on the PR; if that label is unset, a published PR counts.
 * Without a viewer login, pending and review stay off so someone else's PR
 * is not labeled as yours. New, approved, and merged do not need the login.
 */
export function classifyWorktreeListBadges(
  group: WorktreeListBadgeThread[],
  viewerLogin = '',
  reviewLabel = '',
): WorktreeListBadge[] {
  if (group.length === 0 || group.some((t) => t.cowboy)) return [];

  if (group.some((t) => isMergedPrState(t.prUrl, t.prState))) {
    return [listBadge('merged', 'Merged')];
  }
  const note = blockerNote(group);
  if (group.some((t) => isApprovedOpenPr(t))) {
    return [listBadge('approved', 'Approved, not merged', note)];
  }

  const open = group.filter((t) => isOpenPrState(t.prUrl, t.prState));
  if (open.length === 0) {
    if (group.some((t) => isClosedPrState(t.prUrl, t.prState))) return [];
    return [listBadge('new', 'No pull request')];
  }

  const ownership = classifyWorktreeOwnership(group, viewerLogin);
  if (ownership === 'reviewing') {
    return [listBadge('review', "Someone else's PR", note)];
  }

  // Without a viewer login we cannot tell mine vs reviewing, so skip
  // pending and draft — an empty login would badge someone else's PR as yours.
  if (!normalizeViewerLogin(viewerLogin)) return [];

  if (!open.some((t) => !t.prIsDraft)) {
    return [listBadge('draft', 'Draft pull request', note)];
  }

  const readyLabel = reviewLabel.trim();
  const inReview = readyLabel ? labelsInclude(groupPrLabels(group), readyLabel) : true;
  if (!inReview) return [];

  return [listBadge('pending', 'Waiting for review', note)];
}
