import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  run: vi.fn(),
}));

import { gh, git } from './run.js';
import {
  ensureGhPreferOrigin,
  originGhRepoEnv,
  parseGithubSlugFromRemoteUrl,
  resolveGithubRepoSlug,
} from './worktree.js';

const ghMock = vi.mocked(gh);
const gitMock = vi.mocked(git);

let dir: string | null = null;

afterEach(() => {
  ghMock.mockReset();
  gitMock.mockReset();
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe('parseGithubSlugFromRemoteUrl', () => {
  it('parses SSH and HTTPS', () => {
    expect(parseGithubSlugFromRemoteUrl('git@github.com:acme/widgets.git')).toBe(
      'acme/widgets',
    );
    expect(
      parseGithubSlugFromRemoteUrl('https://github.com/acme/widgets.git'),
    ).toBe('acme/widgets');
    expect(
      parseGithubSlugFromRemoteUrl('git@github.com:mattlevine/storycycle-ai'),
    ).toBe('mattlevine/storycycle-ai');
    expect(
      parseGithubSlugFromRemoteUrl('git@github.com-work:acme/widgets.git'),
    ).toBe('acme/widgets');
  });
});

describe('resolveGithubRepoSlug', () => {
  it('parses SSH origin remotes', async () => {
    gitMock.mockResolvedValue({
      stdout: 'git@github.com:acme/widgets.git',
      stderr: '',
      exitCode: 0,
    });
    await expect(resolveGithubRepoSlug('/tmp/repo')).resolves.toBe('acme/widgets');
    expect(ghMock).not.toHaveBeenCalled();
  });

  it('parses HTTPS origin remotes', async () => {
    gitMock.mockResolvedValue({
      stdout: 'https://github.com/acme/widgets.git',
      stderr: '',
      exitCode: 0,
    });
    await expect(resolveGithubRepoSlug('/tmp/repo')).resolves.toBe('acme/widgets');
  });

  it('prefers origin over gh repo view upstream (Makerkit dual-remote)', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
        return {
          stdout: 'git@github.com:mattlevine/storycycle-ai.git',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });
    ghMock.mockResolvedValue({
      stdout: 'makerkit/next-supabase-saas-kit-turbo',
      stderr: '',
      exitCode: 0,
    });
    await expect(resolveGithubRepoSlug('/tmp/storycycle')).resolves.toBe(
      'mattlevine/storycycle-ai',
    );
    expect(ghMock).not.toHaveBeenCalled();
  });

  it('falls back to gh when origin is missing', async () => {
    gitMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
    ghMock.mockResolvedValue({
      stdout: 'acme/from-gh',
      stderr: '',
      exitCode: 0,
    });
    await expect(resolveGithubRepoSlug('/tmp/repo')).resolves.toBe('acme/from-gh');
  });
});

describe('ensureGhPreferOrigin', () => {
  it('sets gh default to origin when upstream exists', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        const remote = args[2];
        if (remote === 'origin') {
          return {
            stdout: 'git@github.com:mattlevine/storycycle-ai.git',
            stderr: '',
            exitCode: 0,
          };
        }
        if (remote === 'upstream') {
          return {
            stdout: 'git@github.com:makerkit/next-supabase-saas-kit-turbo.git',
            stderr: '',
            exitCode: 0,
          };
        }
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });
    ghMock.mockImplementation(async (args) => {
      if (args[0] === 'repo' && args[1] === 'set-default' && args[2] === '--view') {
        return {
          stdout: 'makerkit/next-supabase-saas-kit-turbo',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await ensureGhPreferOrigin('/tmp/storycycle');
    expect(ghMock).toHaveBeenCalledWith(
      ['repo', 'set-default', 'origin'],
      '/tmp/storycycle',
      { reject: false, timeoutMs: 15_000 },
    );
  });

  it('skips when only origin is present', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
        return {
          stdout: 'git@github.com:acme/widgets.git',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await ensureGhPreferOrigin('/tmp/repo');
    expect(ghMock).not.toHaveBeenCalled();
  });
});

describe('originGhRepoEnv', () => {
  it('sets GH_REPO from origin even when upstream exists', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        const remote = args[2];
        if (remote === 'origin') {
          return {
            stdout: 'git@github.com:mattlevine/storycycle-ai.git',
            stderr: '',
            exitCode: 0,
          };
        }
        if (remote === 'upstream') {
          return {
            stdout: 'git@github.com:makerkit/next-supabase-saas-kit-turbo.git',
            stderr: '',
            exitCode: 0,
          };
        }
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });
    ghMock.mockResolvedValue({
      stdout: 'mattlevine/storycycle-ai',
      stderr: '',
      exitCode: 0,
    });

    await expect(originGhRepoEnv('/tmp/storycycle')).resolves.toMatchObject({
      GH_REPO: 'mattlevine/storycycle-ai',
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_0: 'git@github.com:',
      GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_1: 'ssh://git@github.com/',
      GIT_CONFIG_KEY_2: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_2: '!gh auth git-credential',
    });
  });
});

describe('resolveGithubRepoSlug integration', () => {
  it('reads real origin remote', async () => {
    // Unmock for one real-git check
    const { git: realGit, gh: realGh } = await vi.importActual<
      typeof import('./run.js')
    >('./run.js');
    gitMock.mockImplementation(realGit);
    ghMock.mockImplementation(realGh);

    dir = mkdtempSync(join(tmpdir(), 'sideboard-gh-slug-'));
    execaSync('git', ['init'], { cwd: dir });
    execaSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git'], {
      cwd: dir,
    });
    execaSync(
      'git',
      ['remote', 'add', 'upstream', 'git@github.com:makerkit/template.git'],
      { cwd: dir },
    );
    writeFileSync(join(dir, 'README.md'), 'test\n');
    await expect(resolveGithubRepoSlug(dir)).resolves.toBe('acme/widgets');
  });
});
