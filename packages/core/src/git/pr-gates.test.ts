import { describe, expect, it } from 'vitest';
import { buildMergeGateChecks, classifyPrMergeIssue } from './pr-gates.js';

describe('buildMergeGateChecks', () => {
  it('surfaces merge conflicts as a failing row', () => {
    const rows = buildMergeGateChecks({
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      reviewDecision: null,
      baseRefName: 'main',
      url: 'https://github.com/acme/widgets/pull/1',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Merge conflicts',
      bucket: 'fail',
      kind: 'mergeability',
      description: expect.stringContaining('main'),
    });
  });

  it('surfaces CHANGES_REQUESTED as rejected review', () => {
    const rows = buildMergeGateChecks({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'CHANGES_REQUESTED',
      baseRefName: 'main',
      url: null,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Code review',
        state: 'CHANGES_REQUESTED',
        bucket: 'fail',
        kind: 'review',
      }),
    ]);
  });

  it('suppresses generic BLOCKED by default', () => {
    const rows = buildMergeGateChecks({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      reviewDecision: null,
      baseRefName: 'main',
      url: null,
    });
    expect(rows).toEqual([]);
  });

  it('can emit BLOCKED when not suppressed', () => {
    const rows = buildMergeGateChecks(
      {
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
        reviewDecision: null,
        baseRefName: 'main',
        url: null,
      },
      { suppressGenericBlocked: false },
    );
    expect(rows[0]).toMatchObject({ name: 'Merge blocked', bucket: 'fail' });
  });

  it('surfaces GitHub merge queue as a pending row', () => {
    const rows = buildMergeGateChecks({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      baseRefName: 'main',
      url: 'https://github.com/acme/widgets/pull/1',
      isInMergeQueue: true,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Merge queue',
        state: 'QUEUED',
        bucket: 'pending',
        kind: 'mergeability',
      }),
    ]);
  });

  it('treats mergeStateStatus QUEUED as in-queue even without isInMergeQueue', () => {
    const rows = buildMergeGateChecks({
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'QUEUED',
      reviewDecision: null,
      baseRefName: 'main',
      url: null,
    });
    expect(rows[0]).toMatchObject({ name: 'Merge queue', state: 'QUEUED', bucket: 'pending' });
  });
});

describe('classifyPrMergeIssue', () => {
  it('detects conflicts and behind, ignores queued PRs', () => {
    expect(
      classifyPrMergeIssue({
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        reviewDecision: null,
        baseRefName: 'main',
        url: null,
      }),
    ).toBe('conflicts');
    expect(
      classifyPrMergeIssue({
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BEHIND',
        reviewDecision: null,
        baseRefName: 'main',
        url: null,
      }),
    ).toBe('behind');
    expect(
      classifyPrMergeIssue({
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        reviewDecision: null,
        baseRefName: 'main',
        url: null,
        isInMergeQueue: true,
      }),
    ).toBeNull();
    expect(
      classifyPrMergeIssue({
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: null,
        baseRefName: 'main',
        url: null,
      }),
    ).toBeNull();
  });
});
