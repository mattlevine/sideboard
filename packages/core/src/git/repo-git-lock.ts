import { enqueueByKey } from '../util/enqueue-by-key.js';

function repoLockKey(repoPath: string): string {
  const trimmed = repoPath.replace(/\/+$/, '');
  return `git-worktree:${trimmed || '/'}`;
}

/**
 * Serialize `git worktree add` / `remove` (and similar) per repo. Concurrent
 * mutations share `.git` locks; overlapping archives otherwise fail with
 * `index.lock` / `Unable to create`.
 */
export function withRepoGitLock<T>(
  repoPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  return enqueueByKey(repoLockKey(repoPath), fn);
}
