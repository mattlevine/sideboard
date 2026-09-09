import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyWorktreePkgCacheEnv,
  WORKTREE_PKG_CACHE_REL,
  worktreePkgCacheEnv,
  worktreePkgCacheRoot,
} from './worktree-pkg-cache.js';

describe('worktreePkgCacheEnv', () => {
  it('keeps every cache under the worktree scratch dir', () => {
    const env = worktreePkgCacheEnv('/tmp/ws/ajax');
    const root = worktreePkgCacheRoot('/tmp/ws/ajax');
    expect(root).toBe(join('/tmp/ws/ajax', WORKTREE_PKG_CACHE_REL));
    expect(env.npm_config_store_dir).toBe(join(root, 'pnpm-store'));
    expect(env.PNPM_STORE_DIR).toBe(env.npm_config_store_dir);
    expect(env.npm_config_cache_dir).toBe(join(root, 'pnpm'));
    expect(env.npm_config_cache).toBe(join(root, 'npm'));
    expect(env.npm_config_devdir).toBe(join(root, 'node-gyp'));
    expect(env.electron_config_cache).toBe(join(root, 'electron'));
    expect(env.ELECTRON_CACHE).toBeUndefined();
    for (const value of Object.values(env)) {
      expect(value.startsWith('/tmp/ws/ajax/')).toBe(true);
    }
  });
});

describe('applyWorktreePkgCacheEnv', () => {
  it('fills gaps and does not overwrite a user store', () => {
    const env: NodeJS.ProcessEnv = {
      npm_config_store_dir: '/custom/store',
    };
    applyWorktreePkgCacheEnv(env, '/tmp/ws/ajax');
    expect(env.npm_config_store_dir).toBe('/custom/store');
    expect(env.PNPM_STORE_DIR).toBeUndefined();
    expect(env.npm_config_cache).toBe(
      join('/tmp/ws/ajax', WORKTREE_PKG_CACHE_REL, 'npm'),
    );
  });

  it('is a no-op without a worktree path', () => {
    const env: NodeJS.ProcessEnv = {};
    applyWorktreePkgCacheEnv(env, '  ');
    expect(env).toEqual({});
  });

  it('creates the cache root when the worktree exists', () => {
    const wt = mkdtempSync(join(tmpdir(), 'sb-pkg-cache-'));
    applyWorktreePkgCacheEnv({}, wt);
    expect(existsSync(worktreePkgCacheRoot(wt))).toBe(true);
  });
});
