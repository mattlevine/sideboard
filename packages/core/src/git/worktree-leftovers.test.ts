import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyWorktreeLeftovers, saveWorktreeLeftovers } from './worktree-leftovers.js';

const dirs: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('worktree leftovers', () => {
  it('puts dirty and untracked files back uncommitted after the worktree is removed', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sb-left-'));
    dirs.push(repo);
    git(['init', '-b', 'main'], repo);
    git(['config', 'user.email', 't@example.com'], repo);
    git(['config', 'user.name', 't'], repo);
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(['add', 'a.txt'], repo);
    git(['commit', '-m', 'init'], repo);
    const wt = join(repo, 'wt');
    git(['worktree', 'add', '-b', 'thread/demo', wt], repo);
    writeFileSync(join(wt, 'a.txt'), 'dirty\n');
    writeFileSync(join(wt, 'new.txt'), 'untracked\n');

    const ref = await saveWorktreeLeftovers(repo, wt, 'thread/demo');
    expect(ref).toEqual({ ok: true, ref: 'refs/sideboard/leftovers/thread/demo' });

    git(['worktree', 'remove', '--force', wt], repo);
    git(['worktree', 'add', wt, 'thread/demo'], repo);
    expect(await applyWorktreeLeftovers(repo, wt, 'thread/demo')).toBe(true);
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('dirty\n');
    expect(readFileSync(join(wt, 'new.txt'), 'utf8')).toBe('untracked\n');
    const status = git(['status', '--porcelain'], wt);
    expect(status).toMatch(/a\.txt/);
    expect(status).toMatch(/new\.txt/);
    expect(status).not.toMatch(/^A /m);
    expect(await applyWorktreeLeftovers(repo, wt, 'thread/demo')).toBe(false);
  });

  it('leaves the index in place when the snapshot cannot be stored', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sb-left-'));
    dirs.push(repo);
    git(['init', '-b', 'main'], repo);
    git(['config', 'user.email', 't@example.com'], repo);
    git(['config', 'user.name', 't'], repo);
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(['add', 'a.txt'], repo);
    git(['commit', '-m', 'init'], repo);
    const wt = join(repo, 'wt');
    git(['worktree', 'add', '-b', 'thread/demo', wt], repo);
    writeFileSync(join(wt, 'a.txt'), 'staged\n');
    git(['add', 'a.txt'], wt);
    writeFileSync(join(wt, 'a.txt'), 'working\n');
    writeFileSync(join(wt, 'new.txt'), 'untracked\n');

    const notARepo = mkdtempSync(join(tmpdir(), 'sb-left-norepo-'));
    dirs.push(notARepo);
    const saved = await saveWorktreeLeftovers(notARepo, wt, 'thread/demo');
    expect(saved.ok).toBe(false);
    const status = git(['status', '--porcelain'], wt);
    expect(status).toMatch(/^MM a\.txt/m);
    expect(status).toMatch(/^\?\? new\.txt/m);
  });
});
