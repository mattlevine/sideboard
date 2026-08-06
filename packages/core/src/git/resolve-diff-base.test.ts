import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDiffBaseRef } from './worktree.js';
import { getDiff } from '../diff/diff.js';

async function git(cwd: string, args: string[]) {
  await execa('git', args, { cwd });
}

describe('resolveDiffBaseRef', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('prefers origin/<branch> when the remote-tracking ref exists', async () => {
    root = mkdtempSync(join(tmpdir(), 'sb-diff-base-'));
    await git(root, ['init']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'a.txt'), 'a\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'init']);
    await git(root, ['branch', '-M', 'main']);

    // Simulate a remote that advanced past local main.
    await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(root, 'a.txt'), 'stale-local\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'stale local main only']);

    // Feature branch from the remote tip (before stale local commit).
    await git(root, ['checkout', '-b', 'feature', 'origin/main']);
    writeFileSync(join(root, 'feature.txt'), 'feat\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'feature']);

    expect(await resolveDiffBaseRef(root, 'main')).toBe('origin/main');
    expect(await resolveDiffBaseRef(root, 'origin/main')).toBe('origin/main');
    expect(await resolveDiffBaseRef(root, 'fix/foo')).toBe('fix/foo');

    const vsStaleLocal = await execa('git', ['diff', '--name-only', 'main'], { cwd: root });
    expect(vsStaleLocal.stdout.trim().split('\n').length).toBeGreaterThan(1);

    const diff = await getDiff(root, root, { base: 'main', scope: 'commits' });
    expect(diff.files.map((f) => f.path)).toEqual(['feature.txt']);
  });
});
