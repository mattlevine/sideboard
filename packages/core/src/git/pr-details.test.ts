import { describe, expect, it } from 'vitest';
import { resolvePrSelector, resolvePrSelectors } from './worktree.js';

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

describe('resolvePrSelectors', () => {
  it('includes the source branch after the worktree branch for create-from-branch', () => {
    expect(
      resolvePrSelectors({
        prUrl: null,
        sourceType: 'branch',
        sourceRef: 'feat/existing-pr',
        branchName: 'thread/hoffenheim',
      }),
    ).toEqual(['thread/hoffenheim', 'feat/existing-pr']);
  });

  it('does not treat main as a PR head fallback', () => {
    expect(
      resolvePrSelectors({
        prUrl: null,
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: 'thread/paris',
      }),
    ).toEqual(['thread/paris']);
  });
});
