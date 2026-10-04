import { git } from '../git/run.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { threadsSharingWorktree } from './chat-tabs.js';

/**
 * After an agent turn (or land), re-read HEAD and sync branchName across all
 * chat tabs that share the worktree. Chat titles stay on the agent (purpose /
 * soccer nickname) — the sidebar parent reads PR/branch separately.
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

  for (const sibling of siblings) {
    if (sibling.branchName !== branch) {
      updateThread(sibling.id, { branchName: branch });
    }
  }
}
