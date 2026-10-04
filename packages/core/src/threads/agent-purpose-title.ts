import { teamSlugFromName } from '../git/teams.js';
import {
  agentNicknameFromWorktreePath,
  isWorktreeIdentityTitle,
  worktreeIdentityTitles,
} from '../git/worktree-labels.js';
import { REVIEW_TAB_TITLE } from '../review/review-write-gate.js';
import type { Thread } from '../types/thread.js';
import { titleFromPrompt } from './title.js';

/**
 * Agent row title: first-prompt purpose when it is not the PR/branch, else the
 * soccer nickname. Worktree identity stays on the parent card.
 */
export function agentPurposeStamp(input: {
  thread: Pick<
    Thread,
    | 'title'
    | 'userSetTitle'
    | 'worktreePath'
    | 'branchName'
    | 'prTitle'
    | 'sourceType'
    | 'messages'
  >;
  prompt: string;
  autoContinue: boolean;
}): { title: string } | null {
  if (input.autoContinue) return null;
  if (input.thread.sourceType === 'orchestration') return null;
  if (input.thread.title.trim() === REVIEW_TAB_TITLE) return null;

  const identities = worktreeIdentityTitles(input.thread);
  const titled = input.thread.title?.trim() || '';
  const nickname = agentNicknameFromWorktreePath(input.thread.worktreePath);
  const soccerTitle = Boolean(teamSlugFromName(titled));
  const identityTitle = isWorktreeIdentityTitle(titled, identities);
  if (input.thread.userSetTitle && !soccerTitle && !identityTitle) return null;
  const userTurns = (input.thread.messages ?? []).filter(
    (m) => m.role === 'user' && m.origin !== 'continue' && m.text?.trim(),
  ).length;

  if (userTurns <= 1) {
    const purpose = titleFromPrompt(input.prompt);
    if (purpose && !isWorktreeIdentityTitle(purpose, identities)) {
      return { title: purpose };
    }
  }

  if (
    isWorktreeIdentityTitle(titled, identities) &&
    nickname &&
    !isWorktreeIdentityTitle(nickname, identities)
  ) {
    return { title: nickname };
  }
  return null;
}
