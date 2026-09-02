import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  run: vi.fn(),
}));

import { gh, git } from './run.js';
import { markPrReady } from './worktree.js';

const ghMock = vi.mocked(gh);
const gitMock = vi.mocked(git);

afterEach(() => {
  ghMock.mockReset();
  gitMock.mockReset();
});

function originGit(opts?: { dirty?: boolean; unpushed?: number; branch?: string }) {
  const branch = opts?.branch ?? 'feat/x';
  gitMock.mockImplementation(async (args) => {
    if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
      return {
        stdout: 'git@github.com:acme/widgets.git',
        stderr: '',
        exitCode: 0,
      };
    }
    if (args[0] === 'status' && args.includes('--porcelain')) {
      return {
        stdout: opts?.dirty ? ' M foo.ts\n' : '',
        stderr: '',
        exitCode: 0,
      };
    }
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
      return { stdout: `${branch}\n`, stderr: '', exitCode: 0 };
    }
    if (args[0] === 'rev-list' && args.includes('--count')) {
      const vsOrigin = String(args[2] ?? '').startsWith('origin/');
      return {
        stdout: `${vsOrigin ? (opts?.unpushed ?? 0) : 0}\n`,
        stderr: '',
        exitCode: 0,
      };
    }
    return { stdout: '', stderr: '', exitCode: 1 };
  });
}

describe('markPrReady', () => {
  it('runs gh pr ready -R origin when the PR is a draft', async () => {
    originGit();
    ghMock.mockImplementation(async (args) => {
      if (args.includes('view')) {
        return {
          stdout: JSON.stringify({
            url: 'https://github.com/acme/widgets/pull/17',
            state: 'OPEN',
            isDraft: true,
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await expect(markPrReady('/tmp/wt', '17')).resolves.toEqual({
      url: 'https://github.com/acme/widgets/pull/17',
      state: 'OPEN',
      isDraft: false,
    });
    expect(ghMock.mock.calls.some((c) => c[0]?.[0] === 'pr' && c[0]?.[1] === 'ready')).toBe(
      true,
    );
    const readyCall = ghMock.mock.calls.find(
      (c) => c[0]?.[0] === 'pr' && c[0]?.[1] === 'ready',
    );
    expect(readyCall?.[0]).toEqual(['pr', 'ready', '17', '--repo', 'acme/widgets']);
  });

  it('skips gh pr ready when the PR is already open', async () => {
    originGit();
    ghMock.mockImplementation(async (args) => {
      if (args.includes('view')) {
        return {
          stdout: JSON.stringify({
            url: 'https://github.com/acme/widgets/pull/18',
            state: 'OPEN',
            isDraft: false,
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await expect(markPrReady('/tmp/wt', '18')).resolves.toEqual({
      url: 'https://github.com/acme/widgets/pull/18',
      state: 'OPEN',
      isDraft: false,
    });
    expect(ghMock.mock.calls.some((c) => c[0]?.[1] === 'ready')).toBe(false);
  });

  it('throws when gh pr ready fails', async () => {
    originGit();
    ghMock.mockImplementation(async (args) => {
      if (args.includes('view')) {
        return {
          stdout: JSON.stringify({
            url: 'https://github.com/acme/widgets/pull/19',
            state: 'OPEN',
            isDraft: true,
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        return { stdout: '', stderr: 'GraphQL: Resource not accessible', exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await expect(markPrReady('/tmp/wt', '19')).rejects.toThrow(
      'GraphQL: Resource not accessible',
    );
  });

  it('refuses when the worktree is dirty', async () => {
    originGit({ dirty: true });
    ghMock.mockResolvedValue({
      stdout: JSON.stringify({
        url: 'https://github.com/acme/widgets/pull/20',
        state: 'OPEN',
        isDraft: true,
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(markPrReady('/tmp/wt', '20')).rejects.toThrow(
      'Commit and push local work',
    );
    expect(ghMock.mock.calls.some((c) => c[0]?.[1] === 'ready')).toBe(false);
  });

  it('refuses when origin/<branch> is behind local HEAD', async () => {
    originGit({ unpushed: 2 });
    ghMock.mockResolvedValue({
      stdout: JSON.stringify({
        url: 'https://github.com/acme/widgets/pull/21',
        state: 'OPEN',
        isDraft: true,
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(markPrReady('/tmp/wt', '21')).rejects.toThrow(
      'Push this branch to origin',
    );
    expect(ghMock.mock.calls.some((c) => c[0]?.[1] === 'ready')).toBe(false);
  });
});
