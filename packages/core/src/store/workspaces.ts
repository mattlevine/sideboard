import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { loadRepoSettings } from '../hook/settings.js';
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

function canonicalWorkspacePath(repoPath: string): string {
  return canonicalizeRepoPath(repoPath);
}

/** True when both paths are the same checkout, including a linked worktree of it. */
export function sameWorkspacePath(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = canonicalWorkspacePath(a);
  const right = canonicalWorkspacePath(b);
  if (left === right) return true;
  const primaryA = primaryCheckoutFromLinkedWorktree(a);
  const primaryB = primaryCheckoutFromLinkedWorktree(b);
  if (primaryA && (primaryA === right || primaryA === primaryB)) return true;
  if (primaryB && primaryB === left) return true;
  return false;
}

function pathIsInside(parent: string, child: string): boolean {
  const root = parent.replace(/\/+$/, '');
  const path = child.replace(/\/+$/, '');
  if (!root || !path) return false;
  return path === root || path.startsWith(`${root}/`);
}

/** Default `~/sideboard/workspaces/<repo>` without creating the directory. */
function defaultWorktreesRoot(repoPath: string): string {
  const slug = basename(repoPath.replace(/\/+$/, '')) || 'repo';
  return join(homedir(), 'sideboard', 'workspaces', slug);
}

/**
 * A removal stored as a worktree path still covers the project after archive
 * deletes that folder. `~/sideboard/workspaces/<repo>/<worktree>` cannot be
 * resolved through `.git` once the folder is gone.
 */
function removedWorktreeCoversRepo(saved: string, repoPath: string): boolean {
  if (!saved || !repoPath) return false;
  if (pathIsInside(defaultWorktreesRoot(repoPath), saved)) return true;
  try {
    const custom = loadRepoSettings(repoPath)?.worktreesRoot;
    if (custom && pathIsInside(custom, saved)) return true;
  } catch {
    // Checkout has no settings.
  }
  return false;
}

function removedMatches(saved: string, repoPath: string): boolean {
  if (saved === repoPath || sameWorkspacePath(saved, repoPath)) return true;
  const primary = primaryCheckoutFromLinkedWorktree(repoPath);
  if (primary && (sameWorkspacePath(saved, primary) || removedWorktreeCoversRepo(saved, primary))) {
    return true;
  }
  return removedWorktreeCoversRepo(saved, repoPath);
}

/** True when the user removed this project and has not added it again. */
export function isRemovedWorkspace(repoPath: string): boolean {
  if (!repoPath) return false;
  for (const saved of readRemoved()) {
    if (removedMatches(saved, repoPath)) return true;
  }
  return false;
}

/**
 * Chats archived with this removal, including a sibling worktree of that checkout.
 * Older tombstones stay out — they would archive a different project that is
 * still on the sidebar.
 */
export function archivesWithRemovedWorkspace(
  threadRepoPath: string | null | undefined,
  removedPath: string,
): boolean {
  if (!threadRepoPath || isGlobalRepoPath(threadRepoPath)) return false;
  return removedMatches(removedPath, threadRepoPath);
}

function rememberRemoved(repoPath: string): void {
  const next = readRemoved();
  const before = next.size;
  const canon = canonicalWorkspacePath(repoPath);
  next.add(canon);
  const raw = repoPath.replace(/\/+$/, '');
  if (raw && raw !== canon) next.add(raw);
  // Record the main checkout while the folder still exists. Archiving deletes
  // the worktree, and a leftover worktree path can no longer be matched back
  // to the project — thread sync would register the main repo again.
  const primary =
    primaryCheckoutFromLinkedWorktree(repoPath) ??
    (canon !== repoPath ? primaryCheckoutFromLinkedWorktree(canon) : null);
  if (primary) next.add(primary);
  if (next.size !== before) writeRemoved(next);
}

function forgetRemoved(repoPath: string): void {
  const next = readRemoved();
  let changed = false;
  for (const saved of [...next]) {
    if (!removedMatches(saved, repoPath)) continue;
    next.delete(saved);
    changed = true;
  }
  if (changed) writeRemoved(next);
}

export function listWorkspaces(): Workspace[] {
  const all = readAll();
  const valid = all.filter(
    (w) =>
      Boolean(w.path) &&
      w.path !== '/' &&
      w.path !== '.' &&
      !isGlobalRepoPath(w.path) &&
      !isRemovedWorkspace(w.path),
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
  return registerWorkspace(root);
}

/** Register `root` without clearing an explicit removal. Caller checks the tombstone. */
async function registerWorkspace(root: string): Promise<Workspace> {
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
  rememberRemoved(repoPath);
  const canon = canonicalWorkspacePath(repoPath);
  writeAll(readAll().filter((w) => !sameWorkspacePath(w.path, canon)));
}

/**
 * Register a repo unless the user explicitly removed it.
 * Adding the folder again (`addWorkspace`) is what clears that removal.
 */
export async function ensureWorkspace(repoPath: string): Promise<Workspace> {
  const root = await resolveRepoRoot(repoPath);
  if (!root || root === '/' || !existsSync(root)) {
    throw new Error(`Invalid repo path: ${repoPath}`);
  }
  if (isRemovedWorkspace(root)) throw new Error(`Project was removed: ${root}`);
  return registerWorkspace(root);
}

/** Merge in repo paths discovered from existing threads (including archived). */
export function syncWorkspacesFromThreads(repoPaths: string[]): Workspace[] {
  const current = readAll();
  const byPath = new Map<string, Workspace>();
  let dirty = false;
  for (const w of current) {
    const resolved = resolveSyncWorkspacePath(w.path) ?? w.path;
    if (resolved !== w.path) dirty = true;
    if (!resolved || resolved === '/' || isGlobalRepoPath(resolved) || isRemovedWorkspace(resolved)) {
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
    if (!path || path === '/' || isGlobalRepoPath(path) || byPath.has(path) || isRemovedWorkspace(path)) {
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

/** Archive every chat for a removed project, then surface teardown failures. */
export async function archiveRemovedWorkspaceChats(
  threads: Array<{ id: string }>,
  archive: (id: string) => Promise<unknown>,
): Promise<void> {
  const failures: string[] = [];
  for (const thread of threads) {
    try {
      await archive(thread.id);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}
