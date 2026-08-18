import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Well-known bootstrap scripts (GitHub Scripts to Rule Them All, Rails `bin/setup`).
 * Used when Sideboard/Conductor settings and `.cursor/worktrees.json` have no setup.
 */
export const CONVENTION_SETUP_RELPATHS = [
  'script/setup',
  'bin/setup',
  'scripts/setup.sh',
  'scripts/setup',
] as const;

export interface ConventionSetupFile {
  relPath: string;
  absPath: string;
  /** Shell command to run with cwd = worktree. */
  command: string;
  source: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function normPath(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * First matching conventional setup script. Prefers the worktree copy, then the
 * main checkout (so an uncommitted local script still runs in new worktrees).
 */
export function findConventionSetup(
  worktreePath: string,
  repoPath?: string | null,
): ConventionSetupFile | null {
  const roots: Array<{ root: string; where: 'worktree' | 'main repo' }> = [
    { root: worktreePath, where: 'worktree' },
  ];
  if (repoPath && normPath(repoPath) !== normPath(worktreePath)) {
    roots.push({ root: repoPath, where: 'main repo' });
  }

  for (const { root, where } of roots) {
    for (const relPath of CONVENTION_SETUP_RELPATHS) {
      const absPath = join(root, relPath);
      if (!existsSync(absPath) || !isFile(absPath)) continue;
      return {
        relPath,
        absPath,
        command: `bash ${JSON.stringify(absPath)}`,
        source: `${relPath} (${where})`,
      };
    }
  }
  return null;
}

export function hasConventionSetup(
  worktreePath: string,
  repoPath?: string | null,
): boolean {
  return findConventionSetup(worktreePath, repoPath) !== null;
}
