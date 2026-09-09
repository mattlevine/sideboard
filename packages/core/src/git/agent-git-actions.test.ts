import { describe, expect, it } from 'vitest';
import { agentGitPrompt, expandCanonicalGitRequest } from './agent-git-actions.js';

describe('agentGitPrompt', () => {
  it('matches the worktree-agent short git requests', () => {
    expect(agentGitPrompt('commit-push')).toBe('Commit and push.');
    expect(agentGitPrompt('create-draft')).toBe(
      'Commit, push, and open a draft PR.',
    );
    expect(agentGitPrompt('create-web')).toBe(
      'Commit, push, and open a PR in the browser.',
    );
    expect(agentGitPrompt('ready-for-review')).toBe('Ready for review.');
    expect(agentGitPrompt('merge')).toBe('Merge PR.');
  });

  it('names the PR base when resolving conflicts', () => {
    expect(agentGitPrompt('resolve-conflicts', { prBase: 'main' })).toBe(
      'Merge the remote branch (main) into your branch and resolve conflicts. Then, commit and push your changes.',
    );
    expect(agentGitPrompt('resolve-conflicts', { prBase: 'refs/heads/develop' })).toBe(
      'Merge the remote branch (develop) into your branch and resolve conflicts. Then, commit and push your changes.',
    );
    expect(agentGitPrompt('resolve-conflicts')).toBe(
      'Merge the remote branch into your branch and resolve conflicts. Then, commit and push your changes.',
    );
  });
});

describe('expandCanonicalGitRequest', () => {
  it('attaches the meaning to canonical button / ask_git phrases', () => {
    const out = expandCanonicalGitRequest('Commit and push.');
    expect(out.startsWith('Commit and push.')).toBe(true);
    expect(out).toMatch(/do not ask for clarification/);
    expect(out).toMatch(/git push -u origin HEAD/);
    expect(expandCanonicalGitRequest('Merge PR.')).toMatch(/gh stack merge/);
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.')).toMatch(
      /gh pr create --draft -R/,
    );
    expect(expandCanonicalGitRequest('Commit, push, and open a PR in the browser.')).toMatch(
      /--web/,
    );
    expect(expandCanonicalGitRequest('Ready for review.')).toMatch(/gh pr ready/);
  });

  it('names the base when resolving conflicts', () => {
    const out = expandCanonicalGitRequest(agentGitPrompt('resolve-conflicts', { prBase: 'main' }));
    expect(out).toMatch(/Fetch the PR base \(`main`\)/);
    expect(expandCanonicalGitRequest(agentGitPrompt('resolve-conflicts'))).toMatch(
      /Fetch the PR base, merge/,
    );
  });

  it('expands PR sidebar phrases and leaves free-form prompts alone', () => {
    expect(expandCanonicalGitRequest('Fix CI: lint.')).toMatch(/gh run view --log-failed/);
    expect(expandCanonicalGitRequest('Address review comments.')).toMatch(/review feedback/);
    expect(expandCanonicalGitRequest('please commit and push when ready')).toBe(
      'please commit and push when ready',
    );
    expect(expandCanonicalGitRequest('Commit and push. Then deploy.')).toBe(
      'Commit and push. Then deploy.',
    );
  });
});
