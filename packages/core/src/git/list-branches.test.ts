import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { listBranches } from './worktree.js';

async function initRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'sideboard-branches-'));
  await execa('git', ['init', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'a\n');
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

describe('listBranches unmergedOnly', () => {
  it('keeps default + unmerged feature branches, drops merged ones', async () => {
    const root = await initRepo();

    await execa('git', ['checkout', '-b', 'feature-open'], { cwd: root });
    writeFileSync(join(root, 'open.txt'), 'open\n');
    await execa('git', ['add', '.'], { cwd: root });
    await execa('git', ['commit', '-m', 'open work'], { cwd: root });

    await execa('git', ['checkout', 'main'], { cwd: root });
    await execa('git', ['checkout', '-b', 'feature-merged'], { cwd: root });
    writeFileSync(join(root, 'merged.txt'), 'merged\n');
    await execa('git', ['add', '.'], { cwd: root });
    await execa('git', ['commit', '-m', 'merged work'], { cwd: root });
    await execa('git', ['checkout', 'main'], { cwd: root });
    await execa('git', ['merge', '--no-ff', 'feature-merged', '-m', 'merge feature'], {
      cwd: root,
    });

    const all = await listBranches(root);
    expect(all.map((b) => b.name).sort()).toEqual(
      ['feature-merged', 'feature-open', 'main'].sort(),
    );

    const unmerged = await listBranches(root, { unmergedOnly: true });
    const names = unmerged.map((b) => b.name).sort();
    expect(names).toContain('main');
    expect(names).toContain('feature-open');
    expect(names).not.toContain('feature-merged');
  });
});
