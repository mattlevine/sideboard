import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { switchWorktreeBranch } from './worktree.js';

async function initRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'sideboard-switch-br-'));
  await execa('git', ['init', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'a\n');
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

describe('switchWorktreeBranch', () => {
  it('checks out another local branch in the worktree', async () => {
    const root = await initRepo();
    await execa('git', ['branch', 'feature'], { cwd: root });
    await execa('git', ['branch', 'other'], { cwd: root });
    const parent = mkdtempSync(join(tmpdir(), 'sideboard-switch-wt-'));
    const wt = join(parent, 'tree');
    await execa('git', ['worktree', 'add', wt, 'feature'], { cwd: root });

    await switchWorktreeBranch({
      repoPath: root,
      worktreePath: wt,
      branchName: 'other',
    });
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: wt,
    });
    expect(stdout.trim()).toBe('other');
  });

  it('refuses a branch already checked out in another worktree', async () => {
    const root = await initRepo();
    await execa('git', ['branch', 'feature'], { cwd: root });
    const parent = mkdtempSync(join(tmpdir(), 'sideboard-switch-wt-'));
    const wt = join(parent, 'tree');
    await execa('git', ['worktree', 'add', wt, 'feature'], { cwd: root });
    await expect(
      switchWorktreeBranch({
        repoPath: root,
        worktreePath: wt,
        branchName: 'main',
      }),
    ).rejects.toThrow(/already checked out/);
  });
});
