import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { appDataDir } from './paths.js';
import { isGlobalRepoPath } from './global-workspace.js';
import { canonicalizeRepoPath, ensureGhPreferOrigin, resolveRepoRoot } from '../git/worktree.js';

export interface Workspace {
  path: string;
  name: string;
  addedAt: string;
}

function workspacesFile(): string {
  return join(appDataDir(), 'workspaces.json');
}

/** Paths the user explicitly removed; do not re-add via thread sync. */
function removedWorkspacesFile(): string {
  return join(appDataDir(), 'removed-workspaces.json');
}

function readAll(): Workspace[] {
  const path = workspacesFile();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Workspace[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAll(list: Workspace[]): void {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(workspacesFile(), JSON.stringify(list, null, 2), 'utf8');
}

function readRemoved(): Set<string> {
  const path = removedWorkspacesFile();
  if (!existsSync(path)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as string[];
    return new Set(Array.isArray(raw) ? raw.filter((p) => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeRemoved(paths: Set<string>): void {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(removedWorkspacesFile(), JSON.stringify([...paths].sort(), null, 2), 'utf8');
}

function rememberRemoved(repoPath: string): void {
  const next = readRemoved();
  next.add(repoPath);
  writeRemoved(next);
}

function forgetRemoved(repoPath: string): void {
  const next = readRemoved();
  if (!next.delete(repoPath)) return;
  writeRemoved(next);
}

export function listWorkspaces(): Workspace[] {
  const all = readAll();
  const valid = all.filter(
    (w) =>
      Boolean(w.path) &&
      w.path !== '/' &&
      w.path !== '.' &&
      !isGlobalRepoPath(w.path),
  );
  if (valid.length !== all.length) writeAll(valid);
  return valid.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when `path` is a linked git worktree of `mainRepo` (not the main checkout). */
function isLinkedWorktreeOf(path: string, mainRepo: string): boolean {
  if (!path || path === mainRepo) return false;
  const git = join(path, '.git');
  try {
    if (!existsSync(git) || statSync(git).isDirectory()) return false;
    const text = readFileSync(git, 'utf8');
    const needle = `${mainRepo.replace(/\/+$/, '')}/.git`;
    return text.includes(needle);
  } catch {
    return false;
  }
}

/**
 * If `path` is a linked worktree, return the primary checkout. Used by thread
 * sync so leftover worktree `repoPath` values do not re-register as projects.
 */
export function primaryCheckoutFromLinkedWorktree(path: string): string | null {
  if (!path) return null;
  const git = join(path, '.git');
  try {
    if (!existsSync(git) || statSync(git).isDirectory()) return null;
    const text = readFileSync(git, 'utf8');
    const match = /^\s*gitdir:\s*(.+)$/m.exec(text);
    if (!match) return null;
    const gitdir = match[1]!.trim().replace(/\/+$/, '');
    const worktrees = gitdir.lastIndexOf('/.git/worktrees/');
    const root =
      worktrees > 0
        ? gitdir.slice(0, worktrees)
        : gitdir.endsWith('/.git')
          ? gitdir.slice(0, -5)
          : null;
    if (!root) return null;
    return canonicalizeRepoPath(root);
  } catch {
    return null;
  }
}

function resolveSyncWorkspacePath(path: string): string | null {
  if (!path || path === '/') return null;
  const primary = primaryCheckoutFromLinkedWorktree(path);
  if (primary) return primary;
  return canonicalizeRepoPath(path);
}

export async function addWorkspace(repoPath: string): Promise<Workspace> {
  const root = await resolveRepoRoot(repoPath);
  if (!root || root === '/') throw new Error(`Invalid repo path: ${repoPath}`);
  if (!existsSync(root)) throw new Error(`Repo not found: ${root}`);
  forgetRemoved(root);
  // Makerkit-style origin+upstream: make `gh` prefer origin for PR/issue commands.
  await ensureGhPreferOrigin(root);
  const current = readAll();
  const existing = current.find((w) => w.path === root);
  // Drop worktree-as-workspace leftovers (e.g. `pnpm dev` from a Sideboard
  // worktree used to register that checkout instead of the main repo).
  const withoutLinked = current.filter((w) => !isLinkedWorktreeOf(w.path, root));
  if (existing && withoutLinked.length === current.length) return existing;
  const next: Workspace = existing ?? {
    path: root,
    name: basename(root),
    addedAt: new Date().toISOString(),
  };
  writeAll(existing ? withoutLinked : [...withoutLinked, next]);
  return next;
}

export function removeWorkspace(repoPath: string): void {
  writeAll(readAll().filter((w) => w.path !== repoPath));
  rememberRemoved(repoPath);
}

/** Ensure a repo path is registered (e.g. after creating a thread). */
export async function ensureWorkspace(repoPath: string): Promise<Workspace> {
  return addWorkspace(repoPath);
}

/** Merge in repo paths discovered from existing threads (including archived). */
export function syncWorkspacesFromThreads(repoPaths: string[]): Workspace[] {
  const current = readAll();
  const removed = readRemoved();
  const byPath = new Map<string, Workspace>();
  let dirty = false;
  for (const w of current) {
    const resolved = resolveSyncWorkspacePath(w.path) ?? w.path;
    if (resolved !== w.path) dirty = true;
    if (!resolved || resolved === '/' || isGlobalRepoPath(resolved) || removed.has(resolved)) {
      dirty = true;
      continue;
    }
    if (!byPath.has(resolved)) {
      byPath.set(
        resolved,
        resolved === w.path ? w : { ...w, path: resolved, name: basename(resolved) },
      );
    }
  }
  for (const raw of repoPaths) {
    const path = resolveSyncWorkspacePath(raw);
    if (!path || path === '/' || isGlobalRepoPath(path) || byPath.has(path) || removed.has(path)) {
      continue;
    }
    if (!existsSync(path)) continue;
    const ws: Workspace = {
      path,
      name: basename(path),
      addedAt: new Date().toISOString(),
    };
    byPath.set(path, ws);
    dirty = true;
  }
  for (const [path] of byPath) {
    const mains = [...byPath.keys()];
    if (mains.some((main) => isLinkedWorktreeOf(path, main))) {
      byPath.delete(path);
      dirty = true;
    }
  }
  // Never prune: an empty project (no active worktrees) must stay registered
  // until the user explicitly removes it.
  const next = [...byPath.values()];
  if (dirty) writeAll(next);
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
