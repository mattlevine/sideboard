import type { DiffFile, DiffResult } from '../types/thread.js';
import { git } from '../git/run.js';
import { isDirty, resolveDefaultBranch } from '../git/worktree.js';

export async function getDiff(
  worktreePath: string,
  repoPath: string,
  opts?: { base?: string; maxHunkChars?: number },
): Promise<DiffResult> {
  const base = opts?.base ?? (await resolveDefaultBranch(repoPath));
  const maxHunk = opts?.maxHunkChars ?? 8_000;

  const { stdout: nameStatus } = await git(
    ['diff', '--name-status', `${base}...HEAD`],
    worktreePath,
    { reject: false },
  );
  const { stdout: unstagedNames } = await git(
    ['diff', '--name-status'],
    worktreePath,
    { reject: false },
  );
  const { stdout: stagedNames } = await git(
    ['diff', '--name-status', '--cached'],
    worktreePath,
    { reject: false },
  );

  const filesMap = new Map<string, DiffFile>();

  const ingest = async (statusOut: string, range?: string) => {
    for (const line of statusOut.split('\n').filter(Boolean)) {
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts[pathParts.length - 1];
      if (!path) continue;
      const args = range
        ? ['diff', range, '--', path]
        : status?.startsWith('A') || status === '?'
          ? ['diff', '--cached', '--', path]
          : ['diff', '--', path];
      // For uncommitted, prefer working tree diff
      const { stdout: patch } = await git(
        range ? ['diff', `${base}...HEAD`, '--', path] : args,
        worktreePath,
        { reject: false },
      );
      const capped =
        patch.length > maxHunk
          ? `${patch.slice(0, maxHunk)}\n\n… truncated (${patch.length - maxHunk} more chars)`
          : patch;
      filesMap.set(path, {
        path,
        status: status ?? 'M',
        patch: capped,
      });
    }
  };

  await ingest(nameStatus, `${base}...HEAD`);
  await ingest(stagedNames);
  await ingest(unstagedNames);

  const { stdout: stat } = await git(
    ['diff', '--stat', `${base}...HEAD`],
    worktreePath,
    { reject: false },
  );
  const { stdout: dirtyStat } = await git(['diff', '--stat'], worktreePath, {
    reject: false,
  });
  const combinedStat = [stat.trim(), dirtyStat.trim()].filter(Boolean).join('\n');

  return {
    base,
    files: [...filesMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
    stat: combinedStat || '(no changes)',
    dirty: await isDirty(worktreePath),
  };
}

/** Compact summary for MCP token-frugal payloads */
export async function getDiffSummary(
  worktreePath: string,
  repoPath: string,
  opts?: { maxFiles?: number; maxHunkChars?: number },
): Promise<{
  base: string;
  dirty: boolean;
  stat: string;
  files: Array<{ path: string; status: string; patch: string }>;
  truncated: boolean;
}> {
  const full = await getDiff(worktreePath, repoPath, {
    maxHunkChars: opts?.maxHunkChars ?? 2_000,
  });
  const maxFiles = opts?.maxFiles ?? 10;
  return {
    base: full.base,
    dirty: full.dirty,
    stat: full.stat,
    files: full.files.slice(0, maxFiles),
    truncated: full.files.length > maxFiles,
  };
}
