import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  run: vi.fn(),
}));

import { gh, git } from './run.js';
import { getPrChecks, getPrForHeadBranch, getPrMeta } from './worktree.js';

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

function mockGitWithMergeTree(opts: { conflicting: boolean }) {
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
      if (opts.conflicting) {
        return {
          stdout: 'README.md\npackages/core/src/index.ts',
          stderr: 'CONFLICT (content)',
          exitCode: 1,
        };
      }
      return { stdout: 'tree-oid\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });
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
    mockGitWithMergeTree({ conflicting: true });
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
    mockGitWithMergeTree({ conflicting: true });
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

  it('clears GitHub CONFLICTING when local merge-tree is clean', async () => {
    mockGitWithMergeTree({ conflicting: false });
    ghMock
      .mockResolvedValueOnce({
        stdout: '[]',
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
    expect(checks?.some((c) => /merge conflicts/i.test(c.name))).toBe(false);
    expect(gitMock.mock.calls.some((c) => c[0]?.[0] === 'merge-tree')).toBe(true);
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
        mergeable: 'MERGEABLE',
        author: { login: 'sam' },
        reviewRequests: [{ login: 'matt' }],
        labels: [{ name: 'eng-review' }],
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(getPrMeta('/tmp/wt', '42')).resolves.toMatchObject({
      number: 42,
      state: 'OPEN',
      isInMergeQueue: true,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      authorLogin: 'sam',
      reviewerLogins: ['matt'],
      labels: ['eng-review'],
    });
  });

  it('maps CONFLICTING onto PrMeta when local merge-tree still conflicts', async () => {
    mockGitWithMergeTree({ conflicting: true });
    ghMock.mockResolvedValue({
      stdout: JSON.stringify({
        number: 17,
        title: 'Conflicts',
        url: 'https://github.com/acme/widgets/pull/17',
        state: 'OPEN',
        isDraft: true,
        reviewDecision: null,
        baseRefName: 'main',
        headRefName: 'feat/x',
        isInMergeQueue: false,
        mergeStateStatus: 'DIRTY',
        mergeable: 'CONFLICTING',
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(getPrMeta('/tmp/wt', '17')).resolves.toMatchObject({
      number: 17,
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      isInMergeQueue: false,
    });
    expect(gitMock.mock.calls.some((c) => c[0]?.[0] === 'merge-tree')).toBe(true);
  });

  it('treats GitHub CONFLICTING as mergeable when local HEAD is clean', async () => {
    mockGitWithMergeTree({ conflicting: false });
    ghMock.mockResolvedValue({
      stdout: JSON.stringify({
        number: 17,
        title: 'Conflicts',
        url: 'https://github.com/acme/widgets/pull/17',
        state: 'OPEN',
        isDraft: true,
        reviewDecision: null,
        baseRefName: 'main',
        headRefName: 'feat/x',
        isInMergeQueue: false,
        mergeStateStatus: 'DIRTY',
        mergeable: 'CONFLICTING',
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(getPrMeta('/tmp/wt', '17')).resolves.toMatchObject({
      number: 17,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    });
  });

  it('keeps UNSTABLE when GitHub mergeable is UNKNOWN and local tree is clean', async () => {
    mockGitWithMergeTree({ conflicting: false });
    ghMock.mockResolvedValue({
      stdout: JSON.stringify({
        number: 17,
        title: 'CI failing',
        url: 'https://github.com/acme/widgets/pull/17',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: null,
        baseRefName: 'main',
        headRefName: 'feat/x',
        isInMergeQueue: false,
        mergeStateStatus: 'UNSTABLE',
        mergeable: 'UNKNOWN',
      }),
      stderr: '',
      exitCode: 0,
    });
    await expect(getPrMeta('/tmp/wt', '17')).resolves.toMatchObject({
      number: 17,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
    });
  });
});

describe('getPrForHeadBranch', () => {
  beforeEach(() => {
    ghMock.mockReset();
    gitMock.mockReset();
    gitMock.mockResolvedValue({
      stdout: 'git@github.com:acme/widgets.git',
      stderr: '',
      exitCode: 0,
    });
  });

  it('returns the open PR from gh pr list --head', async () => {
    ghMock.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 111,
          title: 'Draft work',
          headRefName: 'feat/existing',
          url: 'https://github.com/acme/widgets/pull/111',
          isCrossRepository: false,
          isDraft: true,
          labels: [{ name: 'eng-review' }],
        },
      ]),
      stderr: '',
      exitCode: 0,
    });
    await expect(getPrForHeadBranch('/repo', 'feat/existing')).resolves.toMatchObject({
      number: 111,
      url: 'https://github.com/acme/widgets/pull/111',
      isDraft: true,
      labels: ['eng-review'],
    });
    const listArgs = ghMock.mock.calls[0]?.[0] as string[];
    expect(listArgs).toContain('--head');
    expect(listArgs).toContain('acme:feat/existing');
    expect(listArgs).toContain('--state');
    expect(listArgs).toContain('open');
    expect(listArgs.join(' ')).toMatch(/isDraft/);
    expect(listArgs.join(' ')).toMatch(/labels/);
  });

  it('falls back to gh pr view when list is empty and that PR is open', async () => {
    ghMock
      .mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 111,
          title: 'Draft work',
          headRefName: 'feat/existing',
          url: 'https://github.com/acme/widgets/pull/111',
          isCrossRepository: false,
          state: 'OPEN',
        }),
        stderr: '',
        exitCode: 0,
      });
    await expect(getPrForHeadBranch('/repo', 'feat/existing')).resolves.toMatchObject({
      number: 111,
    });
  });

  it('ignores a merged view result so a newer open PR can attach', async () => {
    ghMock
      .mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 9,
          title: 'Old',
          headRefName: 'feat/existing',
          url: 'https://github.com/acme/widgets/pull/9',
          state: 'MERGED',
        }),
        stderr: '',
        exitCode: 0,
      });
    await expect(getPrForHeadBranch('/repo', 'feat/existing')).resolves.toBeNull();
  });

  it('skips default branch names', async () => {
    await expect(getPrForHeadBranch('/repo', 'main')).resolves.toBeNull();
    expect(ghMock).not.toHaveBeenCalled();
  });
});
