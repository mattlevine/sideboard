import { describe, expect, it } from 'vitest';
import {
  formatReviewDecision,
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