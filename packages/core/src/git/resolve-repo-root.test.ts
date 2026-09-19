import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalizeRepoPath, resolveRepoRoot } from './worktree.js';

async function git(cwd: string, args: string[]) {
  await execa('git', args, { cwd });
}

describe('resolveRepoRoot', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the main checkout when cwd is a linked worktree', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'sb-repo-root-'));
    dirs.push(parent);
    const main = join(parent, 'main');
    const wt = join(parent, 'sporting-jax');
    mkdirSync(main);
    await git(main, ['init', '-b', 'main']);
    await git(main, ['config', 'user.email', 'test@example.com']);
    await git(main, ['config', 'user.name', 'Test']);
    writeFileSync(join(main, 'a.txt'), '1\n');
    await git(main, ['add', '.']);
    await git(main, ['commit', '-m', 'init']);
    await git(main, ['worktree', 'add', wt, '-b', 'thread/sporting-jax']);

    const fromMain = await resolveRepoRoot(main);
    const fromWorktree = await resolveRepoRoot(wt);
    const expected = canonicalizeRepoPath(main);
    expect(fromMain).toBe(expected);
    expect(fromWorktree).toBe(expected);
    expect(fromWorktree).not.toBe(canonicalizeRepoPath(wt));
  });
});
