import { describe, expect, it } from 'vitest';
import { agentGitPrompt } from './agent-git-actions.js';

describe('agentGitPrompt', () => {
  it('matches the worktree-agent short git requests', () => {
    expect(agentGitPrompt('commit-push')).toBe('Commit and push.');
    expect(agentGitPrompt('create-draft')).toBe(
      'Commit, push, and open a draft PR.',
    );
    expect(agentGitPrompt('create-web')).toBe(
      'Commit, push, and open a PR in the browser.',
    );
    expect(agentGitPrompt('merge')).toBe('Merge PR.');
  });

  it('names the PR base when resolving conflicts', () => {
    expect(agentGitPrompt('resolve-conflicts', { prBase: 'main' })).toBe(
      'Merge origin/main into this branch. Then push.',
    );
    expect(agentGitPrompt('resolve-conflicts', { prBase: 'refs/heads/develop' })).toBe(
      'Merge origin/develop into this branch. Then push.',
    );
    expect(agentGitPrompt('resolve-conflicts')).toBe('Fix merge conflicts.');
  });
});
