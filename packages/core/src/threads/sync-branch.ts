import { git } from '../git/run.js';
import { threadDisplayLabel } from '../git/worktree-labels.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { threadsSharingWorktree } from './chat-tabs.js';

/**
 * After an agent turn (or land), re-read HEAD and sync branchName / cached title
 * across all chat tabs that share the worktree — Conductor-style.
 */
export async function syncThreadBranchFromGit(threadId: string): Promise<void> {
  const thread = readThread(threadId);
  if (!thread?.worktreePath?.trim()) return;

  const { stdout, exitCode } = await git(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    thread.worktreePath,
    { reject: false },
  );
  if (exitCode !== 0) return;
  const branch = stdout.trim();
  if (!branch || branch === 'HEAD') return;

  for (const sibling of threadsSharingWorktree(thread.worktreePath)) {
    const patch: {
      branchName?: string;
      title?: string;
    } = {};
    if (sibling.branchName !== branch) patch.branchName = branch;
    if (!sibling.userSetTitle) {
      const nextTitle = threadDisplayLabel({
        ...sibling,
        branchName: branch,
      });
      if (sibling.title !== nextTitle) patch.title = nextTitle;
    }
    if (Object.keys(patch).length > 0) {
      updateThread(sibling.id, patch);
    }
  }
}
