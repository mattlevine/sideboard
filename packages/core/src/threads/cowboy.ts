import { normalizeWorktreePath } from '../git/worktree-labels.js';
import type { Thread } from '../types/thread.js';

export type CowboyThreadFields = Pick<Thread, 'cowboy' | 'worktreePath' | 'repoPath'>;

export function isCowboyThread(thread: Pick<Thread, 'cowboy'> | null | undefined): boolean {
  return Boolean(thread?.cowboy);
}

/** True when the thread cwd is the registered repo itself (not a `thread/*` worktree). */
export function isPrimaryCheckoutThread(
  thread: Pick<Thread, 'worktreePath' | 'repoPath'> | null | undefined,
): boolean {
  if (!thread?.worktreePath || !thread.repoPath) return false;
  return normalizeWorktreePath(thread.worktreePath) === normalizeWorktreePath(thread.repoPath);
}

/**
 * Archive/purge must not `git worktree remove` the user's project folder.
 * Cowboy chats and adopted primary checkouts both live there.
 */
export function shouldRemoveWorktreeOnTeardown(thread: CowboyThreadFields): boolean {
  return !isCowboyThread(thread) && !isPrimaryCheckoutThread(thread);
}
