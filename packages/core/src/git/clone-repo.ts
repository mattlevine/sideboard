import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { sideboardReposDir } from '../store/paths.js';
import { ensureWorkspace, type Workspace } from '../store/workspaces.js';
import { resolveRepoRoot } from '../git/worktree.js';

/**
 * Clone a repo into ~/sideboard/repos/<name> and register it as a workspace
 * (Conductor Quick-start parity).
 */
export async function cloneRepoIntoSideboard(opts: {
  url: string;
  name?: string;
}): Promise<{ repoPath: string; workspace: Workspace }> {
  const url = opts.url.trim();
  if (!url) throw new Error('Clone URL is required');

  let name = opts.name?.trim();
  if (!name) {
    const leaf = basename(url.replace(/\/$/, '').replace(/\.git$/, ''));
    name = leaf || 'repo';
  }
  name = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';

  const dest = join(sideboardReposDir(), name);
  if (existsSync(dest)) {
    const repoPath = await resolveRepoRoot(dest);
    const workspace = await ensureWorkspace(repoPath);
    return { repoPath, workspace };
  }

  const result = await execa('git', ['clone', url, dest], { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(
      `git clone failed: ${result.stderr?.trim() || result.stdout?.trim() || `exit ${result.exitCode}`}`,
    );
  }
  const repoPath = await resolveRepoRoot(dest);
  const workspace = await ensureWorkspace(repoPath);
  return { repoPath, workspace };
}
