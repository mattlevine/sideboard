import { git } from '../git/run.js';
import { threadDisplayLabel } from '../git/worktree-labels.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { threadsSharingWorktree } from './chat-tabs.js';

/**
 * After an agent turn (or land), re-read HEAD and sync branchName across all
 * chat tabs that share the worktree. Title sync is only for the oldest
 * (canonical) tab when it has no user/tab nickname — forked/new chat tabs keep
 * their soccer-team titles.
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

  const siblings = threadsSharingWorktree(thread.worktreePath);
  const canonicalId = siblings[0]?.id ?? null;

  for (const sibling of siblings) {
    const patch: {
      branchName?: string;
      title?: string;
    } = {};
    if (sibling.branchName !== branch) patch.branchName = branch;
    // Only the primary worktree tab tracks branch/PR display renames.
    if (sibling.id === canonicalId && !sibling.userSetTitle) {
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
