import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveGithubRepoSlug } from './worktree.js';

let dir: string | null = null;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function initRepoWithOrigin(url: string): string {
  dir = mkdtempSync(join(tmpdir(), 'sideboard-gh-slug-'));
  execaSync('git', ['init'], { cwd: dir });
  execaSync('git', ['remote', 'add', 'origin', url], { cwd: dir });
  // Ensure git identity for any incidental commits
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'test\n');
  return dir;
}

describe('resolveGithubRepoSlug', () => {
  it('parses SSH origin remotes', async () => {
    const root = initRepoWithOrigin('git@github.com:acme/widgets.git');
    await expect(resolveGithubRepoSlug(root)).resolves.toBe('acme/widgets');
  });

  it('parses HTTPS origin remotes', async () => {
    const root = initRepoWithOrigin('https://github.com/acme/widgets.git');
    await expect(resolveGithubRepoSlug(root)).resolves.toBe('acme/widgets');
  });
});
