import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  run: vi.fn(),
}));

import { gh, git } from './run.js';
import { getPrChecks, getPrMeta } from './worktree.js';

const ghMock = vi.mocked(gh);
const gitMock = vi.mocked(git);

function mockCleanGate() {
  return {
    stdout: JSON.stringify({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: null,
      baseRefName: 'main',
      url: 'https://github.com/acme/widgets/pull/42',
    }),
    stderr: '',
    exitCode: 0,
  };
}

describe('getPrChecks', () => {
  beforeEach(() => {
    ghMock.mockReset();
    gitMock.mockReset();
    gitMock.mockResolvedValue({
      stdout: 'git@github.com:acme/widgets.git',
      stderr: '',
      exitCode: 0,
    });
  });

  it('returns null when gh reports no pull request for the branch', async () => {
    ghMock.mockResolvedValue({
      stdout: '',
      stderr: 'no pull requests found for branch "thread/monaco"',
      exitCode: 1,
    });
    await expect(getPrChecks('/tmp/wt', 'thread/monaco')).resolves.toBeNull();
    expect(ghMock.mock.calls[0]?.[0]).toContain('--repo');
    expect(ghMock.mock.calls[0]?.[0]).toContain('acme/widgets');
  });

  it('returns empty array when PR exists but has no checks', async () => {
    ghMock
      .mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce(mockCleanGate());
    await expect(getPrChecks('/tmp/wt', '42')).resolves.toEqual([]);
  });

  it('parses check rows from JSON', async () => {
    ghMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            name: 'CI',
            state: 'SUCCESS',
            bucket: 'pass',
            startedAt: '2026-08-05T00:00:00Z',
            completedAt: '2026-08-05T00:01:00Z',
            link: 'https://example.com/1',
            description: null,
            workflow: 'ci.yml',
          },
        ]),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce(mockCleanGate());
    const checks = await getPrChecks('/tmp/wt', '42');
    expect(checks).toHaveLength(1);
    expect(checks?.[0]).toMatchObject({
      name: 'CI',
      bucket: 'pass',
      workflow: 'ci.yml',
      kind: 'ci',
    });
  });

  it('prepends merge conflicts from pr view', async () => {
    ghMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            name: 'CI',
            state: 'SUCCESS',
            bucket: 'pass',
            startedAt: null,
            completedAt: null,
            link: null,
            description: null,
            workflow: null,
          },
        ]),
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          reviewDecision: null,
          baseRefName: 'main',
          url: 'https://github.com/acme/widgets/pull/42',
        }),
        stderr: '',
        exitCode: 0,
      });
    const checks = await getPrChecks('/tmp/wt', '42');
    expect(checks?.[0]).toMatchObject({
      name: 'Merge conflicts',
      bucket: 'fail',
      kind: 'mergeability',
    });
    expect(checks?.[1]).toMatchObject({ name: 'CI', kind: 'ci' });
  });

  it('detects conflicts locally when GitHub mergeable is UNKNOWN', async () => {
    gitMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') {
        return {
          stdout: 'git@github.com:acme/widgets.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'fetch') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'merge-tree') {
        return {
          stdout: 'README.md\npackages/core/src/index.ts',
          stderr: 'CONFLICT (content)',
          exitCode: 1,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    ghMock
      .mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          mergeable: 'UNKNOWN',
          mergeStateStatus: 'UNKNOWN',
          reviewDecision: null,
          baseRefName: 'main',
          url: 'https://github.com/acme/widgets/pull/42',
        }),
        stderr: '',
        exitCode: 0,
      });
    const checks = await getPrChecks('/tmp/wt', '42');
    expect(checks?.[0]).toMatchObject({
      name: 'Merge conflicts',
      bucket: 'fail',
      kind: 'mergeability',
    });
    expect(checks?.[0]?.description).toMatch(/README\.md/);
  });

  it('throws on auth failures instead of pretending checks are empty', async () => {
    ghMock.mockResolvedValue({
      stdout: '',
      stderr:
        'error refreshing token: authentication required\nTo re-authenticate, run: gh auth login',
      exitCode: 1,
    });
    await expect(getPrChecks('/tmp/wt', '42')).rejects.toThrow(/auth/i);
  });

  it('prepends a merge-queue row and skips the local conflict probe', async () => {
    ghMock
      .mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          reviewDecision: 'APPROVED',
          baseRefName: 'main',
          url: 'https://github.com/acme/widgets/pull/42',
          isInMergeQueue: true,
        }),
        stderr: '',
        exitCode: 0,
      });
    const checks = await getPrChecks('/tmp/wt', '42');
    expect(checks).toEqual([
      expect.objectContaining({
        name: 'Merge queue',
        state: 'QUEUED',
        bucket: 'pending',
        kind: 'mergeability',
      }),
    ]);
    expect(gitMock.mock.calls.some((c) => c[0]?.[0] === 'merge-tree')).toBe(false);
  });
});

describe('getPrMeta', () => {
  beforeEach(() => {
    ghMock.mockReset();
    gitMock.mockReset();
    gitMock.mockResolvedValue({
      stdout: 'git@github.com:acme/widgets.git',
      stderr: '',
      exitCode: 0,
    });
  });

  it('maps isInMergeQueue onto PrMeta', async () => {
    ghMock.mockResolvedValue({
      stdout: JSON.stringify({
        number: 42,
        title: 'Queue me',
        url: 'https://github.com/acme/widgets/pull/42',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'APPROVED',
        baseRefName: 'main',
        headRefName: 'feat/queue',
        isInMergeQueue: true,
        mergeStateStatus: 'CLEAN',
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(getPrMeta('/tmp/wt', '42')).resolves.toMatchObject({
      number: 42,
      state: 'OPEN',
      isInMergeQueue: true,
    });
  });
});
