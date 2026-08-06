import { describe, expect, it } from 'vitest';
import {
  formatReviewDecision,
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
