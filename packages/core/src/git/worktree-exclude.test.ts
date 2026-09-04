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

  it('writes .sideboard/ to info/exclude and skip-worktrees tracked files', async () => {
    const dir = await initRepo();
    await ensureWorktreeSideboardIgnored(dir);
    await ensureWorktreeSideboardIgnored(dir);

    const gitDir = (
      await execa('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir })
    ).stdout.trim();
    const exclude = readFileSync(join(gitDir, 'info', 'exclude'), 'utf8');
    expect(exclude.match(/^\.sideboard\/$/gm)?.length).toBe(1);

    writeFileSync(join(dir, '.sideboard', 'settings.toml'), 'setup = "changed"\n');
    writeFileSync(join(dir, '.sideboard', 'plan.md'), '# local\n');
    const status = (await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout;
    expect(status).not.toMatch(/\.sideboard/);
  });
});
