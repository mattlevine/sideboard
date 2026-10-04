import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { worktreesRoot } from '../store/paths.js';
import { listThreads } from '../store/thread-store.js';
import {
  allocateTeamName,
  normalizeTakenSlug,
  takenSlugsFromThread,
  type TeamName,
} from './teams.js';
import { normalizeWorktreePath } from './worktree-labels.js';

function sameRepoPath(a: string, b: string): boolean {
  return normalizeWorktreePath(a) === normalizeWorktreePath(b);
}

/**
 * Local placeholder branch tips (best-effort): unprefixed soccer-team heads and
 * leftover `thread/*` refs under `.git/refs/heads`.
 */
function listLocalPlaceholderBranchSlugs(repoPath: string): string[] {
  const slugs: string[] = [];
  const headsDir = join(repoPath, '.git', 'refs', 'heads');
  const threadDir = join(headsDir, 'thread');
  try {
    if (existsSync(threadDir)) {
      for (const name of readdirSync(threadDir)) {
        if (!name.startsWith('.')) slugs.push(normalizeTakenSlug(name));
      }
    }
    if (existsSync(headsDir)) {
      for (const entry of readdirSync(headsDir, { withFileTypes: true })) {
        if (entry.isFile() && !entry.name.startsWith('.')) {
          slugs.push(normalizeTakenSlug(entry.name));
        }
      }
    }
  } catch {
    return slugs;
  }
  return slugs;
}

/** Slugs already used by worktree dirs, thread records, or leftover placeholder branches. */
export function collectTakenTeamSlugs(repoPath: string): Set<string> {
  const taken = new Set<string>();

  const root = worktreesRoot(repoPath);
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '.DS_Store') {
        for (const slug of takenSlugsFromThread({ worktreePath: entry.name })) {
          taken.add(slug);
        }
      }
    }
  }

  for (const slug of listLocalPlaceholderBranchSlugs(repoPath)) {
    for (const token of takenSlugsFromThread({ branchName: slug })) {
      taken.add(token);
    }
  }

  for (const thread of listThreads({ includeArchived: true })) {
    if (!sameRepoPath(thread.repoPath, repoPath)) continue;
    for (const slug of takenSlugsFromThread(thread)) {
      taken.add(slug);
    }
  }

  return taken;
}

/** Pick an unused soccer team for the worktree directory / branch slug. */
export function allocateTeamSlug(repoPath: string): TeamName {
  const taken = collectTakenTeamSlugs(repoPath);
  // Retry if a dir appeared between collect and allocate (or stale taken set).
  for (let attempt = 0; attempt < 32; attempt++) {
    const team = allocateTeamName(taken);
    const path = join(worktreesRoot(repoPath), team.slug);
    if (!existsSync(path)) return team;
    taken.add(team.slug);
  }
  throw new Error('No available soccer team worktree directories left');
}
