import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { appDataDir } from './paths.js';
import { isGlobalRepoPath } from './global-workspace.js';
import { resolveRepoRoot } from '../git/worktree.js';

export interface Workspace {
  path: string;
  name: string;
  addedAt: string;
}

function workspacesFile(): string {
  return join(appDataDir(), 'workspaces.json');
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

export function listWorkspaces(): Workspace[] {
  return readAll().sort((a, b) => a.name.localeCompare(b.name));
}

export async function addWorkspace(repoPath: string): Promise<Workspace> {
  const root = await resolveRepoRoot(repoPath);
  if (!existsSync(root)) throw new Error(`Repo not found: ${root}`);
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
}

/** Ensure a repo path is registered (e.g. after creating a thread). */
export async function ensureWorkspace(repoPath: string): Promise<Workspace> {
  return addWorkspace(repoPath);
}

/** Merge in repo paths discovered from existing threads. */
export function syncWorkspacesFromThreads(repoPaths: string[]): Workspace[] {
  const current = readAll();
  const byPath = new Map(current.map((w) => [w.path, w]));
  let dirty = false;
  for (const path of repoPaths) {
    if (!path || isGlobalRepoPath(path) || byPath.has(path)) continue;
    if (!existsSync(path)) continue;
    const ws: Workspace = {
      path,
      name: basename(path),
      addedAt: new Date().toISOString(),
    };
    byPath.set(path, ws);
    dirty = true;
  }
  const next = [...byPath.values()];
  if (dirty) writeAll(next);
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
