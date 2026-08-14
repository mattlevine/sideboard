import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { getDiff } from './diff.js';

async function git(cwd: string, args: string[]) {
  await execa('git', args, { cwd });
}

describe('getDiff', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  async function repoWithTwoEdits() {
    root = mkdtempSync(join(tmpdir(), 'sb-get-diff-'));
    await git(root, ['init']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'a.txt'), 'a\n');
    writeFileSync(join(root, 'b.txt'), 'b\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'init']);
    await git(root, ['branch', '-M', 'main']);
    writeFileSync(join(root, 'a.txt'), 'a-changed\n');
    writeFileSync(join(root, 'b.txt'), 'b-changed\n');
    writeFileSync(join(root, 'new.txt'), 'untracked\n');
  }

  it('omits unified patches when includePatches is false', async () => {
    await repoWithTwoEdits();
    const diff = await getDiff(root, root, {
      base: 'main',
      scope: 'uncommitted',
      includePatches: false,
    });
    expect(diff.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt', 'new.txt']);
    for (const file of diff.files) {
      expect(file.patch).toBe('');
    }
    const a = diff.files.find((f) => f.path === 'a.txt');
    expect(a?.additions).toBeGreaterThan(0);
  });

  it('loads a single file patch with path', async () => {
    await repoWithTwoEdits();
    const diff = await getDiff(root, root, {
      base: 'main',
      scope: 'uncommitted',
      path: 'a.txt',
      includeMeta: false,
    });
    expect(diff.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(diff.files[0]?.patch).toContain('a-changed');
    expect(diff.files[0]?.patch).not.toContain('b-changed');
  });

  it('loads an untracked file patch with path', async () => {
    await repoWithTwoEdits();
    const diff = await getDiff(root, root, {
      base: 'main',
      scope: 'uncommitted',
      path: 'new.txt',
      includeMeta: false,
    });
    expect(diff.files.map((f) => f.path)).toEqual(['new.txt']);
    expect(diff.files[0]?.status).toBe('A');
    expect(diff.files[0]?.patch).toContain('untracked');
  });

  it('skips other untracked files when includeUntracked is false', async () => {
    await repoWithTwoEdits();
    const diff = await getDiff(root, root, {
      base: 'main',
      scope: 'uncommitted',
      includePatches: false,
      includeMeta: false,
      includeUntracked: false,
    });
    expect(diff.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
  });

  async function repoWithPushedBranchChange() {
    root = mkdtempSync(join(tmpdir(), 'sb-get-diff-'));
    await git(root, ['init']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'a.txt'), 'a\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'init']);
    await git(root, ['branch', '-M', 'main']);
    await git(root, ['checkout', '-b', 'feat']);
    writeFileSync(join(root, 'a.txt'), 'a-on-branch\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'feat']);
  }

  it('does not treat commits-vs-base files as working-tree dirty', async () => {
    await repoWithPushedBranchChange();
    const withoutMeta = await getDiff(root, root, {
      base: 'main',
      scope: 'commits',
      includePatches: false,
      includeMeta: false,
      includeUntracked: false,
    });
    expect(withoutMeta.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(withoutMeta.dirty).toBe(false);

    const withMeta = await getDiff(root, root, {
      base: 'main',
      scope: 'commits',
      includePatches: false,
      includeMeta: true,
    });
    expect(withMeta.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(withMeta.dirty).toBe(false);
  });

  it('reports dirty when the working tree has uncommitted edits', async () => {
    await repoWithPushedBranchChange();
    writeFileSync(join(root, 'a.txt'), 'a-dirty\n');
    const diff = await getDiff(root, root, {
      base: 'main',
      scope: 'commits',
      includePatches: false,
      includeMeta: true,
    });
    expect(diff.dirty).toBe(true);
  });
});
