import { git } from './run.js';

/** Hidden commits of uncommitted work, kept across `git worktree remove --force`. */
export const LEFTOVER_REF_PREFIX = 'refs/sideboard/leftovers/';

export type LeftoverSaveResult =
  | { ok: true; ref: string | null }
  | { ok: false; error: string };

export function leftoverRefName(branch: string): string {
  const safe = branch.trim().replace(/[^A-Za-z0-9._/-]+/g, '-') || 'branch';
  return `${LEFTOVER_REF_PREFIX}${safe}`;
}

function gitFailure(
  result: { stderr: string; stdout: string },
  fallback: string,
): string {
  const text = (result.stderr || result.stdout).trim();
  return text || fallback;
}

async function restoreIndex(worktreePath: string, treeSha: string): Promise<void> {
  await git(['read-tree', '--reset', treeSha], worktreePath, { reject: false });
}

/**
 * Snapshot a dirty worktree (tracked edits and untracked files, not ignored
 * files) onto `refs/sideboard/leftovers/<branch>` before the folder is removed.
 * `ref` is null when there is nothing to save. `ok: false` means the snapshot
 * failed and the caller must leave the checkout in place. The index is restored
 * when the snapshot fails.
 */
export async function saveWorktreeLeftovers(
  repoPath: string,
  worktreePath: string,
  branch: string,
): Promise<LeftoverSaveResult> {
  const status = await git(['status', '--porcelain'], worktreePath, { reject: false });
  if (status.exitCode !== 0) {
    return { ok: false, error: gitFailure(status, 'git status failed') };
  }
  if (!status.stdout.trim()) return { ok: true, ref: null };

  const indexBefore = await git(['write-tree'], worktreePath, { reject: false });
  const indexSha = indexBefore.stdout.trim();
  if (indexBefore.exitCode !== 0 || !/^[0-9a-f]{7,64}$/i.test(indexSha)) {
    return { ok: false, error: gitFailure(indexBefore, 'git write-tree failed') };
  }

  const fail = async (result: { stderr: string; stdout: string }, fallback: string) => {
    await restoreIndex(worktreePath, indexSha);
    return { ok: false as const, error: gitFailure(result, fallback) };
  };

  const added = await git(['add', '-A'], worktreePath, { reject: false });
  if (added.exitCode !== 0) return fail(added, 'git add failed');

  const tree = await git(['write-tree'], worktreePath, { reject: false });
  const treeSha = tree.stdout.trim();
  if (tree.exitCode !== 0 || !/^[0-9a-f]{7,64}$/i.test(treeSha)) {
    return fail(tree, 'git write-tree failed');
  }

  const head = await git(['rev-parse', 'HEAD'], worktreePath, { reject: false });
  const parent = head.stdout.trim();
  if (head.exitCode !== 0 || !parent) return fail(head, 'git rev-parse HEAD failed');

  const commit = await git(
    ['commit-tree', treeSha, '-p', parent, '-m', 'sideboard leftover'],
    worktreePath,
    { reject: false },
  );
  const sha = commit.stdout.trim();
  if (commit.exitCode !== 0 || !/^[0-9a-f]{7,64}$/i.test(sha)) {
    return fail(commit, 'git commit-tree failed');
  }

  const ref = leftoverRefName(branch);
  const updated = await git(['update-ref', ref, sha], repoPath, { reject: false });
  if (updated.exitCode !== 0) return fail(updated, 'git update-ref failed');

  await git(['reset'], worktreePath, { reject: false });
  return { ok: true, ref };
}

/**
 * Put a saved leftover back as uncommitted files, then drop the ref.
 * Returns false when there is no ref or the apply does not apply cleanly.
 */
export async function applyWorktreeLeftovers(
  repoPath: string,
  worktreePath: string,
  branch: string,
): Promise<boolean> {
  const ref = leftoverRefName(branch);
  const shown = await git(['rev-parse', '--verify', '--quiet', ref], repoPath, { reject: false });
  const sha = shown.stdout.trim();
  if (shown.exitCode !== 0 || !sha) return false;
  const restored = await git(['restore', '--source', sha, '--worktree', '--', '.'], worktreePath, {
    reject: false,
  });
  if (restored.exitCode !== 0) return false;
  await git(['update-ref', '-d', ref], repoPath, { reject: false });
  return true;
}

/** Drop a leftover ref. History Delete uses this so a removed chat cannot come back. */
export async function deleteWorktreeLeftovers(repoPath: string, branch: string): Promise<void> {
  await git(['update-ref', '-d', leftoverRefName(branch)], repoPath, { reject: false });
}
