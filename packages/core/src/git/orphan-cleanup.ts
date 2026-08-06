import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listWorktrees, removeWorktree } from './worktree.js';
import { listThreads } from '../store/thread-store.js';
import { sideboardWorkspacesDir, worktreesRoot } from '../store/paths.js';
import {
  loadAppSettings,
  updateAdvancedSettings,
  type AdvancedAppSettings,
} from '../store/app-settings.js';

export interface OrphanWorktree {
  path: string;
  repoPath: string;
  mtimeMs: number;
}

function isSideboardWorktreePath(path: string): boolean {
  return (
    path.includes('/.sideboard/worktrees/') ||
    path.includes('/sideboard/workspaces/')
  );
}

/** Discover Sideboard worktrees on disk with no matching thread record. */
export async function findOrphanWorktrees(
  repoPaths?: string[],
): Promise<OrphanWorktree[]> {
  const threads = listThreads({ includeArchived: true });
  const known = new Set(threads.map((t) => t.worktreePath.replace(/\/$/, '')));
  const repos = new Set(
    repoPaths?.length
      ? repoPaths
      : threads.map((t) => t.repoPath).filter(Boolean),
  );

  // Also scan home workspaces dirs for repo folders
  const homeRoot = sideboardWorkspacesDir();
  if (existsSync(homeRoot)) {
    try {
      for (const entry of readdirSync(homeRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        // We don't know repo path from slug alone — rely on git worktree list per known repo.
        void entry;
      }
    } catch {
      // ignore
    }
  }

  const orphans: OrphanWorktree[] = [];
  const seen = new Set<string>();

  for (const repoPath of repos) {
    if (!repoPath || !existsSync(repoPath)) continue;
    try {
      const wts = await listWorktrees(repoPath);
      for (const wt of wts) {
        const path = wt.path.replace(/\/$/, '');
        if (!isSideboardWorktreePath(path)) continue;
        if (known.has(path)) continue;
        if (seen.has(path)) continue;
        seen.add(path);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        orphans.push({ path, repoPath, mtimeMs });
      }
    } catch {
      // ignore repos without worktrees
    }

    // Also scan configured worktrees root for dirs not in git worktree list
    try {
      const root = worktreesRoot(repoPath);
      if (existsSync(root)) {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const path = join(root, entry.name).replace(/\/$/, '');
          if (known.has(path) || seen.has(path)) continue;
          // Only treat as orphan if it looks like a git worktree
          if (!existsSync(join(path, '.git'))) continue;
          seen.add(path);
          let mtimeMs = 0;
          try {
            mtimeMs = statSync(path).mtimeMs;
          } catch {
            mtimeMs = Date.now();
          }
          orphans.push({ path, repoPath, mtimeMs });
        }
      }
    } catch {
      // ignore
    }
  }

  return orphans.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export interface CleanupOrphansResult {
  removed: string[];
  kept: string[];
  orphans: OrphanWorktree[];
}

/**
 * Cursor-style cleanup: keep newest worktrees up to maxCount across the machine,
 * remove older orphans (never removes paths still referenced by a thread).
 */
export async function cleanupOrphanWorktrees(opts?: {
  maxCount?: number;
  dryRun?: boolean;
  repoPaths?: string[];
}): Promise<CleanupOrphansResult> {
  const settings = loadAppSettings();
  const maxCount =
    opts?.maxCount ??
    settings.advanced.worktreeMaxCount ??
    25;
  const orphans = await findOrphanWorktrees(opts?.repoPaths);
  const activeCount = listThreads().filter((t) => t.status !== 'archived').length;
  const budget = Math.max(0, maxCount - activeCount);

  // Keep newest orphans within budget; remove the rest (oldest first)
  const sortedNewestFirst = [...orphans].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set(sortedNewestFirst.slice(0, budget).map((o) => o.path));
  const removed: string[] = [];
  const kept: string[] = [];

  for (const orphan of orphans) {
    if (keep.has(orphan.path)) {
      kept.push(orphan.path);
      continue;
    }
    if (opts?.dryRun) {
      removed.push(orphan.path);
      continue;
    }
    try {
      await removeWorktree(orphan.repoPath, orphan.path);
      removed.push(orphan.path);
    } catch {
      kept.push(orphan.path);
    }
  }

  if (!opts?.dryRun) {
    updateAdvancedSettings({
      worktreeLastCleanupAt: new Date().toISOString(),
    });
  }

  return { removed, kept, orphans };
}

export function shouldRunWorktreeCleanup(
  settings = loadAppSettings(),
): boolean {
  const intervalHours = settings.advanced.worktreeCleanupIntervalHours ?? 6;
  const last = settings.advanced.worktreeLastCleanupAt;
  if (!last) return true;
  const elapsed = Date.now() - Date.parse(last);
  return elapsed >= intervalHours * 3600_000;
}

export function worktreeCleanupSettings(): Pick<
  AdvancedAppSettings,
  'worktreeMaxCount' | 'worktreeCleanupIntervalHours' | 'worktreeLastCleanupAt' | 'autoCleanupOrphans'
> {
  const a = loadAppSettings().advanced;
  return {
    worktreeMaxCount: a.worktreeMaxCount,
    worktreeCleanupIntervalHours: a.worktreeCleanupIntervalHours,
    worktreeLastCleanupAt: a.worktreeLastCleanupAt,
    autoCleanupOrphans: a.autoCleanupOrphans,
  };
}
