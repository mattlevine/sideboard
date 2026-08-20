import { basename } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadRepoSettings } from '../hook/settings.js';

export function appDataDir(): string {
  const override = process.env.SIDEBOARD_APP_DATA?.trim();
  const base = override
    ? override
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'sideboard')
      : process.platform === 'win32'
        ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'sideboard')
        : join(homedir(), '.local', 'share', 'sideboard');
  mkdirSync(base, { recursive: true });
  return base;
}

export function threadsDir(): string {
  const dir = join(appDataDir(), 'threads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function locksDir(): string {
  const dir = join(appDataDir(), 'locks');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Conductor-style home root: ~/sideboard */
export function sideboardHomeDir(): string {
  const dir = join(homedir(), 'sideboard');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sideboardReposDir(): string {
  const dir = join(sideboardHomeDir(), 'repos');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sideboardWorkspacesDir(): string {
  const dir = join(sideboardHomeDir(), 'workspaces');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function repoSlug(repoPath: string): string {
  return basename(repoPath.replace(/\/$/, '')) || 'repo';
}

/**
 * Worktree root for a repo (new threads).
 * Default: ~/sideboard/workspaces/<repo-slug>/
 * Override via [.sideboard|.conductor]/settings.toml [worktrees] root = "..."
 *
 * Existing threads keep whatever absolute worktreePath is stored on their record,
 * so older repo-local checkouts continue to work until archived.
 */
export function worktreesRoot(repoPath: string): string {
  const settings = loadRepoSettings(repoPath);
  if (settings?.worktreesRoot) {
    mkdirSync(settings.worktreesRoot, { recursive: true });
    return settings.worktreesRoot;
  }

  const dir = join(sideboardWorkspacesDir(), repoSlug(repoPath));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function threadFilePath(id: string): string {
  return join(threadsDir(), `${id}.json`);
}

/** Live in-flight turn snapshot (tools/thinking) — not the full thread JSON. */
export function threadLivePath(id: string): string {
  return join(threadsDir(), `${id}.live.json`);
}

export function threadLockPath(id: string): string {
  return join(locksDir(), `${id}.lock`);
}

/** Empty synthetic cwd for global orchestration agents (not a git worktree). */
export function globalAgentCwd(): string {
  const dir = join(appDataDir(), 'global');
  mkdirSync(dir, { recursive: true });
  return dir;
}
