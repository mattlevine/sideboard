import { describe, expect, it } from 'vitest';
import {
  classifyMergeIssue,
  formatReviewDecision,
  hasBranchBehindChecks,
  hasMergeConflictChecks,
  prPillModifier,
  prPillStatusLabel,
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

  it('surfaces behind-base over draft', () => {
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