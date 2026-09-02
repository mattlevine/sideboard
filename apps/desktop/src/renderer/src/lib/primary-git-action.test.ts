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
});
