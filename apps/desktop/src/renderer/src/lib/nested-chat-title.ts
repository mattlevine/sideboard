import {
  agentNicknameFromWorktreePath,
  isWorktreeIdentityTitle,
  worktreeIdentityTitles,
} from '@sideboard/worktree-labels';

/** Nested row label: keep the worktree/PR name on the parent, not the chat. */
export function nestedChatDisplayTitle(
  chat: {
    title?: string | null;
    userSetTitle?: boolean;
    worktreePath?: string;
    branchName?: string;
    prTitle?: string | null;
  },
  parentTitle: string,
): string {
  const titled = chat.title?.trim() || '';
  const identities = worktreeIdentityTitles(chat, parentTitle);
  if (titled && !isWorktreeIdentityTitle(titled, identities)) {
    return titled;
  }
  const nickname = chat.worktreePath
    ? agentNicknameFromWorktreePath(chat.worktreePath)
    : null;
  if (nickname && !isWorktreeIdentityTitle(nickname, identities)) {
    return nickname;
  }
  return 'New agent';
}
