import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Per-worktree package caches. Concurrent `pnpm install` across Sideboard
 * worktrees deadlocks on a shared `~/.pnpm-store`; Cursor / Codex sandboxes
 * also refuse native builds that write node-gyp / electron outside the
 * permitted directory (the worktree).
 *
 * Scratch lives under `.context/.sideboard/` (already gitignored).
 */
export const WORKTREE_PKG_CACHE_REL = '.context/.sideboard/pkg-cache';

export function worktreePkgCacheRoot(worktreePath: string): string {
  return join(worktreePath, WORKTREE_PKG_CACHE_REL);
}

export function worktreePkgCacheEnv(worktreePath: string): Record<string, string> {
  const root = worktreePkgCacheRoot(worktreePath);
  const store = join(root, 'pnpm-store');
  const pnpmCache = join(root, 'pnpm');
  const npmCache = join(root, 'npm');
  const nodeGyp = join(root, 'node-gyp');
  const electron = join(root, 'electron');
  return {
    npm_config_store_dir: store,
    PNPM_STORE_DIR: store,
    npm_config_cache_dir: pnpmCache,
    npm_config_cache: npmCache,
    npm_config_devdir: nodeGyp,
    // @electron/get — do not set ELECTRON_CACHE (stripNestedElectronEnv).
    electron_config_cache: electron,
  };
}

function isSet(value: string | undefined): boolean {
  return value != null && value.trim() !== '';
}

function fillGroup(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  keys: readonly string[],
  values: Record<string, string>,
): void {
  if (keys.some((key) => isSet(env[key]))) return;
  for (const key of keys) {
    const value = values[key];
    if (value) env[key] = value;
  }
}

/** Create the cache root when the worktree exists. pnpm/npm create subdirs. */
export function ensureWorktreePkgCacheDirs(worktreePath: string): void {
  if (!existsSync(worktreePath)) return;
  mkdirSync(worktreePkgCacheRoot(worktreePath), { recursive: true });
}

/**
 * Point pnpm / npm / node-gyp / electron download at a worktree-local store.
 * Fills gaps only — a user-set store or cache is left alone.
 */
export function applyWorktreePkgCacheEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  worktreePath: string,
): void {
  const cwd = worktreePath.trim();
  if (!cwd) return;
  const next = worktreePkgCacheEnv(cwd);
  fillGroup(env, ['npm_config_store_dir', 'PNPM_STORE_DIR'], next);
  fillGroup(env, ['npm_config_cache_dir'], next);
  fillGroup(env, ['npm_config_cache'], next);
  fillGroup(env, ['npm_config_devdir'], next);
  fillGroup(env, ['electron_config_cache'], next);
  ensureWorktreePkgCacheDirs(cwd);
}
