import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { isDirty, isSideboardScratchPath } from './worktree.js';

describe('isSideboardScratchPath', () => {
  it('matches attachment scratch only', () => {
    expect(isSideboardScratchPath('.sideboard/attachments/.gitignore')).toBe(
      true,
    );
    expect(isSideboardScratchPath('.sideboard/attachments/Review request.md')).toBe(
      true,
    );
    expect(isSideboardScratchPath('.sideboard/review.md')).toBe(false);
    expect(isSideboardScratchPath('apps/web/lib/foo.ts')).toBe(false);
  });
});

describe('isDirty', () => {
  async function initRepo(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-dirty-'));
    await execa('git', ['init'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), 'hi\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'init'], { cwd: dir });
    return dir;
  }

  it('ignores untracked .sideboard/attachments scratch', async () => {
    const dir = await initRepo();
    mkdirSync(join(dir, '.sideboard', 'attachments'), { recursive: true });
    writeFileSync(
      join(dir, '.sideboard', 'attachments', '.gitignore'),
      '*\n!.gitignore\n',
    );
    writeFileSync(
      join(dir, '.sideboard', 'attachments', 'Review request.md'),
      'Review.\n',
    );

    await expect(isDirty(dir)).resolves.toBe(false);
  });

  it('still reports real untracked or modified files', async () => {
    const dir = await initRepo();
    writeFileSync(join(dir, 'new.ts'), 'export {}\n');
    await expect(isDirty(dir)).resolves.toBe(true);

    mkdirSync(join(dir, '.sideboard', 'attachments'), { recursive: true });
    writeFileSync(
      join(dir, '.sideboard', 'attachments', '.gitignore'),
      '*\n!.gitignore\n',
    );
    await expect(isDirty(dir)).resolves.toBe(true);
  });
});
