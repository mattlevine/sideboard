import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  originCli: vi.fn(),
}));

import { originCli } from './run.js';
import { cursorPrChecks, cursorViewToPrMeta, listCursorPrs } from './cursor-pr.js';

const originMock = vi.mocked(originCli);

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0 };
}

describe('listCursorPrs', () => {
  beforeEach(() => {
    originMock.mockReset();
  });

  it('asks Origin for review fields and keeps the unclaimed labeled queue', async () => {
    originMock.mockResolvedValue(
      ok(
        JSON.stringify([
          {
            number: 1,
            title: 'Open seat',
            headRefName: 'feat/a',
            url: 'https://cursor.com/acme/widgets/pull/1',
            state: 'open',
            isDraft: false,
            reviewDecision: 'required',
            labels: [{ name: 'eng-review' }],
            reviewRequests: [{ kind: 'team', slug: 'acme/eng', name: 'Eng' }],
            author: { displayName: 'Ada' },
          },
          {
            number: 2,
            title: 'Taken',
            headRefName: 'feat/b',
            url: 'https://cursor.com/acme/widgets/pull/2',
            state: 'open',
            labels: [{ name: 'eng-review' }],
            reviewRequests: [{ kind: 'user', name: 'Pat Lee', id: 'u1' }],
          },
          {
            number: 3,
            title: 'Missing label',
            headRefName: 'feat/c',
            url: 'https://cursor.com/acme/widgets/pull/3',
            state: 'open',
            labels: [],
            reviewRequests: [],
          },
          {
            number: 4,
            title: 'Draft',
            headRefName: 'feat/d',
            url: 'https://cursor.com/acme/widgets/pull/4',
            state: 'draft',
            isDraft: true,
            labels: [{ name: 'eng-review' }],
            reviewRequests: [],
          },
        ]),
      ),
    );

    const rows = await listCursorPrs('/tmp/wt', 'acme/widgets', { queue: 'review', limit: 3 });
    const args = originMock.mock.calls[0]?.[0] ?? [];
    expect(args).toContain('--label');
    expect(args).toContain('eng-review');
    expect(args[args.indexOf('--limit') + 1]).toBe('80');
    const json = args[args.indexOf('--json') + 1] ?? '';
    expect(json).toContain('labels');
    expect(json).toContain('reviewRequests');
    expect(json).toContain('reviewDecision');
    expect(rows.map((row) => row.number)).toEqual([1]);
    expect(rows[0]?.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(rows[0]?.author?.login).toBe('Ada');
  });

  it('uses the GitHub list cap when no review filter is set', async () => {
    originMock.mockResolvedValue(ok('[]'));
    await listCursorPrs('/tmp/wt', 'acme/widgets');
    const args = originMock.mock.calls[0]?.[0] ?? [];
    expect(args[args.indexOf('--limit') + 1]).toBe('200');
    expect(args).not.toContain('--label');
    expect(args[args.indexOf('--json') + 1]).not.toContain('reviewRequests');
  });
});

describe('cursor checks', () => {
  beforeEach(() => {
    originMock.mockReset();
  });

  it('adds conflict and review rows from origin pr view', async () => {
    originMock.mockImplementation(async (args: string[]) => {
      if (args[1] === 'checks') {
        return ok(
          JSON.stringify([
            { name: 'ci', status: 'completed', conclusion: 'success', link: 'https://ci.example/1' },
          ]),
        );
      }
      return ok(
        JSON.stringify({
          url: 'https://cursor.com/acme/widgets/pull/7',
          baseRefName: 'main',
          reviewDecision: 'changes_requested',
          mergeability: {
            hasMergeConflicts: true,
            mergeConflictState: 'MERGE_CONFLICT_STATE_CONFLICTS',
          },
        }),
      );
    });

    const checks = await cursorPrChecks('/tmp/wt', 'acme/widgets', '7');
    expect(checks?.map((row) => row.name)).toEqual(['Merge conflicts', 'Code review', 'ci']);
    expect(checks?.[0]).toMatchObject({ bucket: 'fail', kind: 'mergeability' });
    expect(checks?.[1]).toMatchObject({ state: 'CHANGES_REQUESTED', kind: 'review' });
  });

  it('maps a pending conflict check to unknown mergeability', () => {
    expect(
      cursorViewToPrMeta({
        number: 1,
        title: 't',
        url: 'https://cursor.com/acme/widgets/pull/1',
        state: 'OPEN',
        reviewDecision: 'required',
        mergeability: { hasMergeConflicts: false, mergeConflictState: 'MERGE_CONFLICT_STATE_PENDING' },
      }),
    ).toMatchObject({
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
    });
  });
});
