import type { Thread } from '../types/thread.js';

/** Review chat tab title from {@link requestReview} / the desktop Review button. */
export const REVIEW_TAB_TITLE = 'Review';

/**
 * Threads where posting a comment or ticket/PR update notifies the author
 * before the human reviewer has signed off.
 *
 * Review tabs (any parent) and `sourceType=pr` worktrees (review inbox).
 * Ticket/branch work on a PR the viewer authored stays ungated.
 */
export function isReviewWriteGatedThread(
  thread: Pick<Thread, 'sourceType' | 'title'>,
): boolean {
  return thread.sourceType === 'pr' || thread.title.trim() === REVIEW_TAB_TITLE;
}

/** First-turn playbook: keep the review in chat until the user posts it. */
export function formatReviewWriteGateDirective(): string {
  return [
    'Review writes are public. The PR author sees GitHub/Linear comments, ticket updates, and submitted reviews immediately — a draft will confuse them.',
    'Write the recommendation in chat. Do not call github_comment, linear_comment, abletime_comment, github_update_issue, linear_update_issue, abletime_update_task, or run `gh pr review` / `gh pr comment`, until the user confirms.',
    'After the review is in chat, ask_user (Post this review / Keep it in chat), then wait. If they already asked you to post a specific comment or update in this turn, that is confirmation.',
    'Do not request reviewers, change labels, or assign yourself unless they asked — those also notify the author.',
  ].join('\n');
}

/** Standing reminder (survives CLI `--resume`). */
export function formatReviewWriteGateReminder(): string {
  return 'Review writes: keep the review in chat. ask_user (Post this review / Keep it in chat) before github_comment / linear_comment / *_update_* / `gh pr review`. The PR author sees those immediately.';
}
