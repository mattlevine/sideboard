import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
}));

import { gh, git } from './run.js';
import { fetchPrHead, resolveWorktreeStartPoint } from './worktree.js';

const gitMock = vi.mocked(git);
const ghMock = vi.mocked(gh);

describe('resolveWorktreeStartPoint', () => {
  beforeEach(() => {
    gitMock.mockReset();
    ghMock.mockReset();
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

  it('throws a clear error when the PR head cannot be fetched', async () => {
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
