import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { appDataDir } from './paths.js';
import { isGlobalRepoPath } from './global-workspace.js';
import { ensureGhPreferOrigin, resolveRepoRoot } from '../git/worktree.js';

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

export async function addWorkspace(repoPath: string): Promise<Workspace> {
  const root = await resolveRepoRoot(repoPath);
  if (!root || root === '/') throw new Error(`Invalid repo path: ${repoPath}`);
  if (!existsSync(root)) throw new Error(`Repo not found: ${root}`);
  forgetRemoved(root);
  // Makerkit-style origin+upstream: make `gh` prefer origin for PR/issue commands.
  await ensureGhPreferOrigin(root);
  const current = readAll();
  const existing = current.find((w) => w.path === root);
  if (existing) return existing;
  const next: Workspace = {
    path: root,
    name: basename(root),
    addedAt: new Date().toISOString(),
  };
  writeAll([...current, next]);
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
  const byPath = new Map(current.map((w) => [w.path, w]));
  let dirty = false;
  for (const path of repoPaths) {
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
  // Never prune: an empty project (no active worktrees) must stay registered
  // until the user explicitly removes it.
  const next = [...byPath.values()];
  if (dirty) writeAll(next);
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
