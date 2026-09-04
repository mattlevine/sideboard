import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { ensureWorktreeSideboardIgnored } from './worktree-exclude.js';

describe('ensureWorktreeSideboardIgnored', () => {
  async function initRepo(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-exclude-'));
    await execa('git', ['init'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), 'hi\n');
    mkdirSync(join(dir, '.sideboard'), { recursive: true });
    writeFileSync(join(dir, '.sideboard', 'settings.toml'), 'setup = "true"\n');
    await execa('git', ['add', 'README.md', '.sideboard/settings.toml'], { cwd: dir });
    await execa('git', ['commit', '-m', 'init'], { cwd: dir });
    return dir;
  }

  it('writes .sideboard/ and .context/ to info/exclude and skip-worktrees tracked files', async () => {
    const dir = await initRepo();
    await ensureWorktreeSideboardIgnored(dir);
    await ensureWorktreeSideboardIgnored(dir);

    const gitDir = (
      await execa('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir })
    ).stdout.trim();
    const exclude = readFileSync(join(gitDir, 'info', 'exclude'), 'utf8');
    expect(exclude.match(/^\.sideboard\/$/gm)?.length).toBe(1);
    expect(exclude.match(/^\.context\/$/gm)?.length).toBe(1);

    writeFileSync(join(dir, '.sideboard', 'settings.toml'), 'setup = "changed"\n');
    writeFileSync(join(dir, '.sideboard', 'plan.md'), '# local\n');
    mkdirSync(join(dir, '.context', '.sideboard', 'detached-jobs', 'x'), {
      recursive: true,
    });
    writeFileSync(
      join(dir, '.context', '.sideboard', 'detached-jobs', 'x', 'log'),
      'hi\n',
    );
    const status = (await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout;
    expect(status).not.toMatch(/\.sideboard/);
    expect(status).not.toMatch(/\.context/);
  });

  it('appends .context/ when exclude already has .sideboard/', async () => {
    const dir = await initRepo();
    const gitDir = (
      await execa('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir })
    ).stdout.trim();
    const excludePath = join(gitDir, 'info', 'exclude');
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(
      excludePath,
      '# Sideboard worktree scratch — do not commit\n.sideboard/\n',
      'utf8',
    );
    await ensureWorktreeSideboardIgnored(dir);
    const exclude = readFileSync(excludePath, 'utf8');
    expect(exclude.match(/^\.sideboard\/$/gm)?.length).toBe(1);
    expect(exclude.match(/^\.context\/$/gm)?.length).toBe(1);
  });
});
