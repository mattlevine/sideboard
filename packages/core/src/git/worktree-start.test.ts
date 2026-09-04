import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { wtRoot } = vi.hoisted(() => ({ wtRoot: { current: '/tmp/sb-wt-root' } }));

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  resolveGhAuthToken: vi.fn(),
}));

vi.mock('../store/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/paths.js')>();
  return {
    ...actual,
    worktreesRoot: () => wtRoot.current,
  };
});

vi.mock('../store/app-settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/app-settings.js')>();
  return {
    ...actual,
    getGithubGitAuthMode: () => 'auto' as const,
    getGithubPat: () => null,
  };
});

import { gh, git, resolveGhAuthToken } from './run.js';
import { resetGithubAgentTokenMemo } from './git-auth-mode.js';
import {
  createThreadWorktree,
  fetchOriginForWorktree,
  fetchPrHead,
  originFetchBranch,
  resolveWorktreeStartPoint,
} from './worktree.js';

const gitMock = vi.mocked(git);
const ghMock = vi.mocked(gh);
const tokenMock = vi.mocked(resolveGhAuthToken);

describe('resolveWorktreeStartPoint', () => {
  beforeEach(() => {
    gitMock.mockReset();
    ghMock.mockReset();
    tokenMock.mockReset();
    resetGithubAgentTokenMemo();
  });

  it('prefers origin/<branch> after fetch so forks track remote main', async () => {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'rev-parse --verify origin/main') {
        return { stdout: 'abc123', stderr: '', exitCode: 0 };
      }
      if (key === 'rev-parse --verify main') {
        return { stdout: 'oldlocal', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(resolveWorktreeStartPoint('/repo', 'main')).resolves.toBe(
      'origin/main',
    );
  });

  it('falls back to local ref when remote tip is missing', async () => {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'rev-parse --verify origin/sideboard-pr-9') {
        return { stdout: '', stderr: '', exitCode: 1 };
      }
      if (key === 'rev-parse --verify sideboard-pr-9') {
        return { stdout: 'prsha', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      resolveWorktreeStartPoint('/repo', 'sideboard-pr-9'),
    ).resolves.toBe('sideboard-pr-9');
  });

  it('keeps explicit origin/ refs', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args.join(' ') === 'rev-parse --verify origin/main') {
        return { stdout: 'abc', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      resolveWorktreeStartPoint('/repo', 'origin/main'),
    ).resolves.toBe('origin/main');
  });

  it('throws when neither remote nor local tip exists', async () => {
    gitMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
    await expect(
      resolveWorktreeStartPoint('/repo', 'sideboard-pr-77'),
    ).rejects.toThrow(/Invalid git reference: sideboard-pr-77/);
  });
});

describe('fetchPrHead', () => {
  beforeEach(() => {
    gitMock.mockReset();
    ghMock.mockReset();
    tokenMock.mockReset();
    resetGithubAgentTokenMemo();
  });

  it('force-fetches pull/N/head into the local branch from origin', async () => {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'remote get-url origin') {
        return {
          stdout: 'https://github.com/acme/app.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (key === 'fetch origin +pull/77/head:sideboard-pr-77') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (key === 'rev-parse --verify sideboard-pr-77') {
        return { stdout: 'deadbeef', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      fetchPrHead('/repo', 77, 'sideboard-pr-77'),
    ).resolves.toBeUndefined();
    expect(gitMock).toHaveBeenCalledWith(
      ['fetch', 'origin', '+pull/77/head:sideboard-pr-77'],
      '/repo',
      { reject: false },
    );
  });

  it('falls back to github.com/<slug> when origin lacks pull refs', async () => {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'remote get-url origin') {
        return {
          stdout: 'git@github.com:me/fork.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (key === 'fetch origin +pull/77/head:sideboard-pr-77') {
        return {
          stdout: '',
          stderr: "couldn't find remote ref pull/77/head",
          exitCode: 1,
        };
      }
      if (
        key ===
        'fetch https://github.com/me/fork.git +pull/77/head:sideboard-pr-77'
      ) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (key === 'rev-parse --verify sideboard-pr-77') {
        return { stdout: 'abc', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      fetchPrHead('/repo', 77, 'sideboard-pr-77'),
    ).resolves.toBeUndefined();
  });

  it('retries HTTPS with gh auth when SSH and anonymous HTTPS fail', async () => {
    tokenMock.mockResolvedValue('gho_test_token');
    gitMock.mockImplementation(async (args, _cwd, opts) => {
      const key = args.join(' ');
      if (key === 'remote get-url origin') {
        return {
          stdout: 'git@github.com:mattlevine/brightsy-ai.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (key === 'fetch origin +pull/91/head:sideboard-pr-91') {
        return {
          stdout: '',
          stderr: 'Permission denied (publickey).',
          exitCode: 1,
        };
      }
      if (
        key ===
        'fetch https://github.com/mattlevine/brightsy-ai.git +pull/91/head:sideboard-pr-91'
      ) {
        if (opts?.config?.['http.extraHeader']?.includes('gho_test_token')) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return {
          stdout: '',
          stderr: "could not read Username for 'https://github.com'",
          exitCode: 1,
        };
      }
      if (key === 'rev-parse --verify sideboard-pr-91') {
        return { stdout: 'a5ba994', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      fetchPrHead('/repo', 91, 'sideboard-pr-91'),
    ).resolves.toBeUndefined();
    expect(tokenMock).toHaveBeenCalled();
    expect(gitMock).toHaveBeenCalledWith(
      [
        'fetch',
        'https://github.com/mattlevine/brightsy-ai.git',
        '+pull/91/head:sideboard-pr-91',
      ],
      '/repo',
      expect.objectContaining({
        reject: false,
        env: { GIT_TERMINAL_PROMPT: '0' },
        config: {
          'http.extraHeader': 'AUTHORIZATION: bearer gho_test_token',
        },
      }),
    );
  });

  it('throws a clear error when the PR head cannot be fetched', async () => {
    tokenMock.mockResolvedValue(null);
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'remote get-url origin') {
        return {
          stdout: 'https://github.com/acme/app.git',
          stderr: '',
          exitCode: 0,
        };
      }
      return {
        stdout: '',
        stderr: "couldn't find remote ref",
        exitCode: 1,
      };
    });
    ghMock.mockResolvedValue({
      stdout: '',
      stderr: 'Could not resolve to a PullRequest',
      exitCode: 1,
    });

    await expect(
      fetchPrHead('/repo', 77, 'sideboard-pr-77'),
    ).rejects.toThrow(/Failed to fetch PR #77 head into sideboard-pr-77/);
  });
});

describe('originFetchBranch', () => {
  it('maps default and origin-qualified refs to the remote branch name', () => {
    expect(originFetchBranch('main')).toBe('main');
    expect(originFetchBranch('origin/main')).toBe('main');
    expect(originFetchBranch('refs/heads/main')).toBe('main');
    expect(originFetchBranch('refs/remotes/origin/main')).toBe('main');
    expect(originFetchBranch('fix/panel')).toBe('fix/panel');
  });

  it('skips local-only PR fetch branches', () => {
    expect(originFetchBranch('sideboard-pr-12')).toBeNull();
  });
});

describe('fetchOriginForWorktree', () => {
  beforeEach(() => {
    gitMock.mockReset();
    ghMock.mockReset();
    tokenMock.mockReset();
    resetGithubAgentTokenMemo();
  });

  it('fetches the start-point branch before a full prune', async () => {
    const order: string[] = [];
    gitMock.mockImplementation(async (args) => {
      order.push(args.join(' '));
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await expect(fetchOriginForWorktree('/repo', 'main')).resolves.toBe(true);
    expect(order[0]).toBe('fetch origin main');
    expect(order).toContain('fetch origin --prune');
  });

  it('retries the tip fetch over HTTPS when SSH is denied', async () => {
    tokenMock.mockResolvedValue('gho_fetch');
    gitMock.mockImplementation(async (args, _cwd, opts) => {
      if (args.join(' ') === 'fetch origin main') {
        if (opts?.config?.['http.extraHeader']?.includes('gho_fetch')) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return {
          stdout: '',
          stderr: 'Permission denied (publickey).',
          exitCode: 128,
        };
      }
      if (args.join(' ') === 'fetch origin --prune') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(fetchOriginForWorktree('/repo', 'origin/main')).resolves.toBe(
      true,
    );
    expect(gitMock).toHaveBeenCalledWith(
      ['fetch', 'origin', 'main'],
      '/repo',
      expect.objectContaining({
        reject: false,
        env: expect.objectContaining({
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_VALUE_0: 'git@github.com:',
          GIT_CONFIG_VALUE_1: 'ssh://git@github.com/',
        }),
        config: {
          'http.extraHeader': 'AUTHORIZATION: bearer gho_fetch',
        },
      }),
    );
  });

  it('does not fetch local PR heads', async () => {
    await expect(fetchOriginForWorktree('/repo', 'sideboard-pr-3')).resolves.toBe(
      false,
    );
    expect(gitMock).not.toHaveBeenCalled();
  });
});

describe('createThreadWorktree', () => {
  beforeEach(() => {
    gitMock.mockReset();
    ghMock.mockReset();
    tokenMock.mockReset();
    resetGithubAgentTokenMemo();
    wtRoot.current = mkdtempSync(join(tmpdir(), 'sb-wt-root-'));
  });

  afterEach(() => {
    rmSync(wtRoot.current, { recursive: true, force: true });
  });

  function mockCreateGit() {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key.startsWith('remote get-url')) {
        return key.endsWith(' origin')
          ? {
              stdout: 'https://github.com/acme/app.git',
              stderr: '',
              exitCode: 0,
            }
          : { stdout: '', stderr: '', exitCode: 1 };
      }
      if (args[0] === 'fetch') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (key === 'rev-parse --verify origin/main') {
        return { stdout: 'abc123', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });
  }

  it('adds the worktree from origin/main after fetching, without pulling the main checkout', async () => {
    mockCreateGit();
    const created = await createThreadWorktree({
      repoPath: '/repo',
      sourceRef: 'main',
      slug: 'ajax',
    });

    expect(created.branchName).toBe('thread/ajax');
    expect(created.worktreePath).toBe(join(wtRoot.current, 'ajax'));

    const verbs = gitMock.mock.calls.map((c) => c[0]?.[0]);
    expect(verbs).toContain('fetch');
    expect(verbs.indexOf('fetch')).toBeLessThan(verbs.indexOf('worktree'));
    expect(verbs).not.toContain('pull');
    expect(verbs).not.toContain('checkout');
    expect(verbs).not.toContain('reset');
    // Project folder is not on main in this mock — skip ff-only merge.
    expect(verbs).not.toContain('merge');

    const add = gitMock.mock.calls.find(
      (c) => c[0]?.[0] === 'worktree' && c[0]?.[1] === 'add',
    );
    expect(add?.[0]).toEqual([
      'worktree',
      'add',
      '-b',
      'thread/ajax',
      join(wtRoot.current, 'ajax'),
      'origin/main',
    ]);
    expect(
      gitMock.mock.calls.some((c) => c[0]?.join(' ') === 'fetch origin main'),
    ).toBe(true);
  });
});
