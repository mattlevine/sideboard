import { describe, expect, it } from 'vitest';
import { resolvePrSelector } from './worktree.js';

describe('resolvePrSelector', () => {
  it('prefers prUrl', () => {
    expect(
      resolvePrSelector({
        prUrl: 'https://github.com/a/b/pull/9',
        sourceType: 'pr',
        sourceRef: '9',
        branchName: 'feat/x',
      }),
    ).toBe('https://github.com/a/b/pull/9');
  });

  it('uses PR source ref next', () => {
    expect(
      resolvePrSelector({
        prUrl: null,
        sourceType: 'pr',
        sourceRef: '#42',
        branchName: 'feat/x',
      }),
    ).toBe('42');
  });

  it('falls back to branch name', () => {
    expect(
      resolvePrSelector({
        prUrl: null,
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: 'fix/cli-teams-switch-json',
      }),
    ).toBe('fix/cli-teams-switch-json');
  });
});
