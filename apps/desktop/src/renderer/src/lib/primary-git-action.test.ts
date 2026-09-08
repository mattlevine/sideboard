import { describe, expect, it } from 'vitest';
import {
  primaryGitAction,
  primaryGitIcon,
  primaryGitLabel,
} from './primary-git-action';

const open = {
  prMerged: false,
  prClosed: false,
  cowboy: false,
  hasPr: true,
  prDraft: false,
  inMergeQueue: false,
  mergeConflicts: false,
  branchBehind: false,
  hasLocalChanges: false,
  originInSync: true,
};

describe('primaryGitAction', () => {
  it('marks a clean draft PR ready for review instead of merge', () => {
    expect(primaryGitAction({ ...open, prDraft: true })).toBe('ready-for-review');
    expect(primaryGitLabel('ready-for-review')).toBe('Ready for review');
    expect(primaryGitIcon('ready-for-review')).toBe('✓');
  });

  it('keeps commit/resolve/update ahead of ready-for-review', () => {
    expect(
      primaryGitAction({
        ...open,
        prDraft: true,
        hasLocalChanges: true,
        originInSync: false,
      }),
    ).toBe('commit-push');
    expect(
      primaryGitAction({ ...open, prDraft: true, mergeConflicts: true }),
    ).toBe('resolve');
    expect(
      primaryGitAction({ ...open, prDraft: true, branchBehind: true }),
    ).toBe('update');
  });

  it('does not mark ready until origin has every local commit', () => {
    expect(
      primaryGitAction({
        ...open,
        prDraft: true,
        hasLocalChanges: false,
        originInSync: false,
      }),
    ).toBe('commit-push');
  });

  it('merges a clean open (non-draft) PR', () => {
    expect(primaryGitAction(open)).toBe('merge');
    expect(primaryGitLabel('merge')).toBe('Merge');
  });

  it('does not offer Merge while a required review is outstanding', () => {
    expect(primaryGitAction({ ...open, reviewDecision: 'REVIEW_REQUIRED' })).toBe(
      'needs-approval',
    );
    expect(primaryGitLabel('needs-approval')).toBe('Needs approval');
    expect(primaryGitIcon('needs-approval')).toBe('○');
    expect(
      primaryGitAction({ ...open, reviewDecision: 'CHANGES_REQUESTED' }),
    ).toBe('changes-requested');
    expect(primaryGitLabel('changes-requested')).toBe('Rejected');
  });

  it('keeps update / commit ahead of a missing approval', () => {
    expect(
      primaryGitAction({
        ...open,
        reviewDecision: 'REVIEW_REQUIRED',
        branchBehind: true,
      }),
    ).toBe('update');
    expect(
      primaryGitAction({
        ...open,
        reviewDecision: 'REVIEW_REQUIRED',
        hasLocalChanges: true,
        originInSync: false,
      }),
    ).toBe('commit-push');
  });

  it('treats merge conflicts as a failure and behind-base as an update', () => {
    expect(primaryGitAction({ ...open, mergeConflicts: true })).toBe('resolve');
    expect(primaryGitLabel('resolve')).toBe('Resolve');
    expect(primaryGitAction({ ...open, branchBehind: true })).toBe('update');
    expect(primaryGitLabel('update')).toBe('Update');
    expect(
      primaryGitAction({ ...open, branchBehind: true, checksFailed: true }),
    ).toBe('update');
    expect(
      primaryGitAction({ ...open, mergeConflicts: true, checksFailed: true }),
    ).toBe('resolve');
  });

  it('does not offer Merge while CI is red or still running', () => {
    expect(primaryGitAction({ ...open, checksFailed: true })).toBe('checks-failing');
    expect(primaryGitLabel('checks-failing')).toBe('Checks failing');
    expect(primaryGitAction({ ...open, checksPending: true })).toBe('checks-pending');
    expect(primaryGitLabel('checks-pending')).toBe('Checks pending');
    expect(
      primaryGitAction({
        ...open,
        checksFailed: true,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    ).toBe('checks-failing');
    expect(
      primaryGitAction({
        ...open,
        checksPending: true,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
    ).toBe('needs-approval');
  });
});
