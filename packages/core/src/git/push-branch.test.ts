import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  resolveGhAuthToken: vi.fn(),
}));

vi.mock('../store/app-settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/app-settings.js')>();
  return {
    ...actual,
    getGithubGitAuthMode: () => 'auto' as const,
    getGithubPat: () => null,
  };
});

import { git, resolveGhAuthToken } from './run.js';
import { resetGithubAgentTokenMemo } from './git-auth-mode.js';
import { pushBranch } from './worktree.js';

const gitMock = vi.mocked(git);
const tokenMock = vi.mocked(resolveGhAuthToken);

afterEach(() => {
  gitMock.mockReset();
  tokenMock.mockReset();
  resetGithubAgentTokenMemo();
});

describe('pushBranch', () => {
  it('returns after a successful SSH push', async () => {
    gitMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    await pushBranch('/tmp/wt', 'feat/site');
    expect(gitMock).toHaveBeenCalledTimes(1);
    expect(gitMock.mock.calls[0]?.[0]).toEqual(['push', '-u', 'origin', 'feat/site']);
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('retries over HTTPS with the gh token when SSH is denied', async () => {
    gitMock.mockImplementation(async (args, _cwd, opts) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return {
          stdout: 'git@github.com:mattlevine/sideboard.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (opts?.config?.['http.extraHeader']?.includes('gho_test')) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return {
        stdout: '',
        stderr: 'Permission denied (publickey).',
        exitCode: 128,
      };
    });
    tokenMock.mockResolvedValue('gho_test');

    await pushBranch('/tmp/wt', 'feat/site');
    const httpsCall = gitMock.mock.calls.find((c) =>
      c[2]?.config?.['http.extraHeader']?.includes('AUTHORIZATION: bearer gho_test'),
    );
    expect(httpsCall?.[2]?.env?.GIT_CONFIG_VALUE_0).toBe('git@github.com:');
    expect(httpsCall?.[2]?.env?.GIT_CONFIG_VALUE_1).toBe('ssh://git@github.com/');
    expect(httpsCall?.[2]?.config?.['http.extraHeader']).toContain('gho_test');
  });

  it('falls back to Basic x-access-token when bearer is rejected', async () => {
    gitMock.mockImplementation(async (args, _cwd, opts) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return {
          stdout: 'git@github.com:mattlevine/sideboard.git',
          stderr: '',
          exitCode: 0,
        };
      }
      const header = opts?.config?.['http.extraHeader'] ?? '';
      if (header.startsWith('Authorization: Basic ')) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return {
        stdout: '',
        stderr: header ? 'invalid credentials' : 'Permission denied (publickey).',
        exitCode: 128,
      };
    });
    tokenMock.mockResolvedValue('gho_test');

    await pushBranch('/tmp/wt', 'feat/site');
    const basicCall = gitMock.mock.calls.find((c) =>
      c[2]?.config?.['http.extraHeader']?.startsWith('Authorization: Basic '),
    );
    expect(basicCall).toBeTruthy();
  });

  it('rewrites ssh:// remotes on the HTTPS retry', async () => {
    gitMock.mockImplementation(async (args, _cwd, opts) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return {
          stdout: 'ssh://git@github.com/mattlevine/sideboard.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (opts?.config?.['http.extraHeader']?.includes('gho_test')) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return {
        stdout: '',
        stderr: 'Permission denied (publickey).',
        exitCode: 128,
      };
    });
    tokenMock.mockResolvedValue('gho_test');

    await pushBranch('/tmp/wt', 'feat/site');
    const httpsCall = gitMock.mock.calls.find((c) =>
      c[2]?.config?.['http.extraHeader']?.includes('gho_test'),
    );
    expect(httpsCall?.[2]?.env?.GIT_CONFIG_VALUE_1).toBe('ssh://git@github.com/');
  });

  it('throws the SSH error when gh has no token', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return {
          stdout: 'git@github.com:mattlevine/sideboard.git',
          stderr: '',
          exitCode: 0,
        };
      }
      return {
        stdout: '',
        stderr: 'Permission denied (publickey).',
        exitCode: 128,
      };
    });
    tokenMock.mockResolvedValue(null);

    await expect(pushBranch('/tmp/wt', 'feat/site')).rejects.toThrow(
      /gh auth token unavailable|Permission denied/,
    );
  });
});
