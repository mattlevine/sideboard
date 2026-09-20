import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('workspaces store', () => {
  let dataDir: string;
  let repoPath: string;

  beforeEach(() => {
    dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'sideboard-ws-')));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    repoPath = join(dataDir, 'my-project');
    mkdirSync(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
    repoPath = realpathSync(repoPath);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps a registered project after syncing with no active threads', async () => {
    const mod = await import('./workspaces.js');
    const added = await mod.addWorkspace(repoPath);
    expect(mod.listWorkspaces().map((w) => w.path)).toContain(added.path);

    // Simulate post-archive: no active thread paths to discover.
    const listed = mod.syncWorkspacesFromThreads([]);
    expect(listed.map((w) => w.path)).toContain(added.path);
    expect(mod.listWorkspaces().map((w) => w.path)).toContain(added.path);
  });

  it('re-discovers a project from an archived thread path', async () => {
    const mod = await import('./workspaces.js');
    // Not yet registered — only known via a (archived) thread repoPath.
    const listed = mod.syncWorkspacesFromThreads([repoPath]);
    expect(listed.map((w) => w.path)).toContain(repoPath);
    expect(mod.listWorkspaces().map((w) => w.path)).toContain(repoPath);
  });

  it('does not re-add an explicitly removed project from thread sync', async () => {
    const mod = await import('./workspaces.js');
    const added = await mod.addWorkspace(repoPath);
    mod.removeWorkspace(added.path);
    expect(mod.listWorkspaces().map((w) => w.path)).not.toContain(added.path);

    const listed = mod.syncWorkspacesFromThreads([added.path]);
    expect(listed.map((w) => w.path)).not.toContain(added.path);
  });

  it('replaces a linked-worktree workspace with the main checkout', async () => {
    const mod = await import('./workspaces.js');
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoPath,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoPath });
    const wt = join(dataDir, 'sporting-jax');
    execFileSync('git', ['worktree', 'add', wt, '-b', 'thread/sporting-jax'], {
      cwd: repoPath,
    });

    await mod.addWorkspace(wt);
    const paths = mod.listWorkspaces().map((w) => w.path);
    expect(paths).toContain(repoPath);
    expect(paths).not.toContain(realpathSync(wt));
  });

  it('sync maps a leftover worktree repoPath to the main checkout', async () => {
    const mod = await import('./workspaces.js');
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoPath,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoPath });
    const wt = join(dataDir, 'sporting-jax');
    execFileSync('git', ['worktree', 'add', wt, '-b', 'thread/sporting-jax'], {
      cwd: repoPath,
    });

    const listed = mod.syncWorkspacesFromThreads([realpathSync(wt)]);
    const paths = listed.map((w) => w.path);
    expect(paths).toContain(repoPath);
    expect(paths).not.toContain(realpathSync(wt));
  });

  it('rewrites a stored worktree workspace to the main checkout', async () => {
    const mod = await import('./workspaces.js');
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoPath,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoPath });
    const wt = join(dataDir, 'stored-wt');
    execFileSync('git', ['worktree', 'add', wt, '-b', 'thread/stored-wt'], {
      cwd: repoPath,
    });
    writeFileSync(
      join(dataDir, 'workspaces.json'),
      JSON.stringify([
        {
          path: realpathSync(wt),
          name: 'stored-wt',
          addedAt: new Date().toISOString(),
        },
      ]),
    );
    const listed = mod.syncWorkspacesFromThreads([]);
    const paths = listed.map((w) => w.path);
    expect(paths).toContain(repoPath);
    expect(paths).not.toContain(realpathSync(wt));
  });

  it('ensureWorkspace re-registers after remove', async () => {
    const mod = await import('./workspaces.js');
    const added = await mod.addWorkspace(repoPath);
    mod.removeWorkspace(added.path);
    const again = await mod.ensureWorkspace(added.path);
    expect(mod.listWorkspaces().map((w) => w.path)).toContain(again.path);
  });
});
