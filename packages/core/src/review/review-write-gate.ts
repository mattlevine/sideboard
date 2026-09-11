import type { Thread } from '../types/thread.js';

/** Review chat tab title from {@link requestReview} / the desktop Review button. */
export const REVIEW_TAB_TITLE = 'Review';

export type ReviewWriteGateThread = Pick<Thread, 'sourceType' | 'title'> & {
  id?: string;
};

export type ReviewWriteGateSibling = Pick<Thread, 'id' | 'title' | 'status'>;

function hasLiveReviewSibling(
  thread: ReviewWriteGateThread,
  siblings: ReviewWriteGateSibling[] = [],
): boolean {
  const selfId = thread.id;
  return siblings.some(
    (t) =>
      t.id !== selfId &&
      t.status !== 'archived' &&
      t.title.trim() === REVIEW_TAB_TITLE,
  );
}

/**
 * Threads where posting a comment or ticket/PR update notifies the author
 * before the human has worked through the review in chat.
 *
 * Review tabs, `sourceType=pr` worktrees (review inbox), and any sibling tab
 * on a worktree that has a live Review tab (so a ticket implementation chat
 * cannot post findings while Review is open). Branch work without a Review
 * tab stays ungated.
 */
export function isReviewWriteGatedThread(
  thread: ReviewWriteGateThread,
  siblings?: ReviewWriteGateSibling[],
): boolean {
  if (thread.sourceType === 'pr' || thread.title.trim() === REVIEW_TAB_TITLE) {
    return true;
  }
  return hasLiveReviewSibling(thread, siblings);
}

/** First-turn playbook: keep the review in chat until the user posts it. */
export function formatReviewWriteGateDirective(): string {
  return [
    'Review writes are public. The PR or ticket author sees GitHub/Linear/AbleTime comments, ticket updates, and submitted reviews immediately — a draft will confuse them.',
    'Write the recommendation in chat so the user can work through the feedback first. Do not call github_comment, linear_comment, abletime_comment, github_update_issue, linear_update_issue, abletime_update_task, or run `gh pr review` / `gh pr comment`, until the user confirms.',
    'After the review is in chat, ask_user (Post this review / Keep it in chat), then wait. If they already asked you to post a specific comment or update in this turn, that is confirmation.',
    'Do not request reviewers, change labels, or assign yourself unless they asked — those also notify the author.',
  ].join('\n');
}

/** Standing reminder (survives CLI `--resume`). */
export function formatReviewWriteGateReminder(): string {
  return 'Review writes: keep the review in chat so they can work through it. ask_user (Post this review / Keep it in chat) before github_comment / linear_comment / *_update_* / `gh pr review` on the PR or ticket. Authors see those immediately.';
}
