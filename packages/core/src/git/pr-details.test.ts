import { describe, expect, it } from 'vitest';
import { parsePrDetailsView, resolvePrSelector, resolvePrSelectors } from './worktree.js';

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

describe('parsePrDetailsView', () => {
  it('maps assignees, labels, and requested reviewers', () => {
    const details = parsePrDetailsView({
      number: 84,
      title: 'feat: defaults',
      body: '',
      url: 'https://github.com/acme/app/pull/84',
      state: 'OPEN',
      isDraft: false,
      reviewDecision: 'REVIEW_REQUIRED',
      author: { login: 'matt' },
      baseRefName: 'main',
      headRefName: 'feat/x',
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      comments: [],
      reviews: [],
      assignees: [{ login: 'matt' }],
      labels: [{ name: 'eng-review' }, 'orchestrator'],
      reviewRequests: [{ login: 'alice' }, { slug: 'engineering-team' }],
    });
    expect(details.assignees).toEqual(['matt']);
    expect(details.labels).toEqual(['eng-review', 'orchestrator']);
    expect(details.reviewers).toEqual(['alice']);
    expect(details.teams).toEqual(['engineering-team']);
    expect(details.reviewRequests).toEqual(['alice', 'engineering-team']);
  });
});
