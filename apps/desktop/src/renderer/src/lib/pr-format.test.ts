import { describe, expect, it } from 'vitest';
import type { PrCheckRun } from '@sideboard-ai/core';
import {
  classifyMergeIssue,
  formatReviewDecision,
  hasBranchBehindChecks,
  hasMergeConflictChecks,
  prPillModifier,
  prPillStatusLabel,
  checksFromRuns,
  checksTabShortLabel,
  summarizeChecks,
} from './pr-format';

describe('formatReviewDecision', () => {
  it('maps GitHub reviewDecision values', () => {
    expect(formatReviewDecision('REVIEW_REQUIRED')).toBe('Needs approval');
    expect(formatReviewDecision('APPROVED')).toBe('Approved');
    expect(formatReviewDecision('CHANGES_REQUESTED')).toBe('Rejected');
    expect(formatReviewDecision(null)).toBeNull();
  });
});

describe('pr pill status', () => {
  it('prefers lifecycle over review decision', () => {
    expect(
      prPillStatusLabel({
        merged: true,
        closed: false,
        draft: false,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    ).toBe('Merged');
    expect(
      prPillModifier({
        merged: false,
        closed: true,
        draft: false,
        reviewDecision: 'APPROVED',
      }),
    ).toBe('closed');
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: true,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    ).toBe('Draft');
  });

  it('surfaces merge conflicts over draft / review decision', () => {
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: true,
        reviewDecision: 'APPROVED',
        mergeConflicts: true,
      }),
    ).toBe('Merge conflicts');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: true,
        reviewDecision: 'APPROVED',
        mergeConflicts: true,
      }),
    ).toBe('conflicts');
  });

  it('surfaces behind-base over draft without the conflicts (red) modifier', () => {
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: true,
        reviewDecision: 'APPROVED',
        branchBehind: true,
        baseRefName: 'main',
      }),
    ).toBe('Behind main');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: true,
        reviewDecision: 'APPROVED',
        branchBehind: true,
      }),
    ).toBe('behind');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: true,
        reviewDecision: 'APPROVED',
        mergeConflicts: true,
        branchBehind: true,
      }),
    ).toBe('conflicts');
  });

  it('shows needs approval / open / approved for open PRs', () => {
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    ).toBe('Needs approval');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    ).toBe('needs-approval');
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: null,
      }),
    ).toBe('Open');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'APPROVED',
      }),
    ).toBe('approved');
  });

  it('surfaces CI check status when review is not the blocker', () => {
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: null,
        checksPassed: true,
      }),
    ).toBe('Checks passing');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: null,
        checksPassed: true,
      }),
    ).toBe('approved');
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'APPROVED',
        checksFailed: true,
      }),
    ).toBe('Checks failing');
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'REVIEW_REQUIRED',
        checksPassed: true,
      }),
    ).toBe('Needs approval');
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'APPROVED',
        checksPending: true,
      }),
    ).toBe('Checks pending');
  });

  it('shows Queued when the PR is in a GitHub merge queue', () => {
    expect(
      prPillStatusLabel({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'APPROVED',
        inMergeQueue: true,
      }),
    ).toBe('Queued');
    expect(
      prPillModifier({
        merged: false,
        closed: false,
        draft: false,
        reviewDecision: 'APPROVED',
        mergeConflicts: true,
        inMergeQueue: true,
      }),
    ).toBe('queued');
  });
});

describe('hasMergeConflictChecks', () => {
  it('detects CONFLICTING / DIRTY mergeability rows', () => {
    expect(hasMergeConflictChecks([])).toBe(false);
    expect(
      hasMergeConflictChecks([
        { kind: 'mergeability', state: 'CONFLICTING', name: 'Merge conflicts' },
      ]),
    ).toBe(true);
    expect(
      hasMergeConflictChecks([{ kind: 'mergeability', state: 'BEHIND', name: 'Branch behind' }]),
    ).toBe(false);
  });
});

describe('hasBranchBehindChecks', () => {
  it('detects BEHIND mergeability rows', () => {
    expect(
      hasBranchBehindChecks([{ kind: 'mergeability', state: 'BEHIND', name: 'Branch behind' }]),
    ).toBe(true);
    expect(
      hasBranchBehindChecks([
        { kind: 'mergeability', state: 'CONFLICTING', name: 'Merge conflicts' },
      ]),
    ).toBe(false);
  });
});

describe('classifyMergeIssue', () => {
  it('maps GitHub mergeable / mergeStateStatus', () => {
    expect(
      classifyMergeIssue({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
    ).toBe('conflicts');
    expect(classifyMergeIssue({ mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' })).toBe(
      'behind',
    );
    expect(
      classifyMergeIssue({
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        inMergeQueue: true,
      }),
    ).toBeNull();
  });
});

describe('checksFromRuns', () => {
  const run = (bucket: PrCheckRun['bucket']): PrCheckRun => ({
    name: 'CI',
    state: 'SUCCESS',
    bucket,
    startedAt: null,
    completedAt: null,
    link: null,
    description: null,
    workflow: null,
    kind: 'ci',
  });

  it('maps pass / fail / pending buckets', () => {
    expect(checksFromRuns(null)).toEqual({
      checksFailed: false,
      checksPending: false,
      checksPassed: false,
    });
    expect(checksFromRuns([run('pass')])).toEqual({
      checksFailed: false,
      checksPending: false,
      checksPassed: true,
    });
    expect(checksFromRuns([run('fail')])).toMatchObject({
      checksFailed: true,
      checksPassed: false,
    });
    expect(checksTabShortLabel([run('pass')])).toBe('CI ✓');
    expect(checksTabShortLabel([run('fail')])).toBe('CI 1✕');
  });

  it('does not treat behind-base info as a CI failure', () => {
    const behind: PrCheckRun = {
      name: 'Branch behind',
      state: 'BEHIND',
      bucket: 'info',
      startedAt: null,
      completedAt: null,
      link: null,
      description: null,
      workflow: 'mergeability',
      kind: 'mergeability',
    };
    expect(summarizeChecks([behind])).toEqual({
      failed: 0,
      pending: 0,
      passed: 0,
      total: 0,
      label: '',
    });
    expect(checksFromRuns([behind, run('pass')])).toEqual({
      checksFailed: false,
      checksPending: false,
      checksPassed: true,
    });
    expect(summarizeChecks([behind, run('pass')]).label).toBe('Passed (1/1)');
    expect(checksTabShortLabel([behind])).toBe('CI');
  });

  it('counts merge conflicts as a Checks-tab failure but not as CI red', () => {
    const conflicts: PrCheckRun = {
      name: 'Merge conflicts',
      state: 'CONFLICTING',
      bucket: 'fail',
      startedAt: null,
      completedAt: null,
      link: null,
      description: null,
      workflow: 'mergeability',
      kind: 'mergeability',
    };
    expect(summarizeChecks([conflicts, run('pass')])).toEqual({
      failed: 1,
      pending: 0,
      passed: 1,
      total: 2,
      label: 'Failed (1/2)',
    });
    expect(checksFromRuns([conflicts, run('pass')])).toEqual({
      checksFailed: false,
      checksPending: false,
      checksPassed: true,
    });
    expect(checksTabShortLabel([conflicts])).toBe('CI');
    expect(checksTabShortLabel([conflicts, run('fail')])).toBe('CI 1✕');
    expect(
      checksFromRuns([
        {
          name: 'Code review',
          state: 'CHANGES_REQUESTED',
          bucket: 'fail',
          startedAt: null,
          completedAt: null,
          link: null,
          description: null,
          workflow: 'review',
          kind: 'review',
        },
        run('pass'),
      ]),
    ).toEqual({
      checksFailed: false,
      checksPending: false,
      checksPassed: true,
    });
  });
});
