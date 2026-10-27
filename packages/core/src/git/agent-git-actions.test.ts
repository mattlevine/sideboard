import { describe, expect, it } from 'vitest';
import {
  agentGitPrompt,
  expandCanonicalGitRequest,
  resolveSidebarGitPrompt,
} from './agent-git-actions.js';

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
    expect(agentGitPrompt('merge', { prBase: 'main' })).toBe('Merge PR.');
    expect(agentGitPrompt('merge', { prBase: 'master' })).toBe('Merge PR.');
    expect(agentGitPrompt('merge', { prBase: 'develop' })).toBe(
      'Merge PR into develop.',
    );
    expect(agentGitPrompt('merge', { prBase: 'refs/heads/matt/parent' })).toBe(
      'Merge PR into matt/parent.',
    );
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
    const intoParent = expandCanonicalGitRequest(
      agentGitPrompt('merge', { prBase: 'matt/parent' }),
    );
    expect(intoParent.startsWith('Merge PR into matt/parent.')).toBe(true);
    expect(intoParent).toMatch(/into `matt\/parent`/);
    expect(intoParent).toMatch(/gh pr merge/);
    expect(intoParent).toMatch(/do not use `gh stack merge`/);
    expect(intoParent).not.toMatch(/If `gh stack view` shows a stack/);
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.')).toMatch(
      /gh pr create --draft --assignee @me -R/,
    );
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.')).toMatch(
      /if the user named someone else/,
    );
    expect(expandCanonicalGitRequest('Commit, push, and open a PR in the browser.')).toMatch(
      /--web --assignee @me/,
    );
    expect(expandCanonicalGitRequest('Ready for review.')).toMatch(/gh pr ready/);
  });

  it('uses the origin CLI when the checkout is Cursor', () => {
    const forge = { forge: 'cursor' as const };
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.', forge)).toMatch(
      /origin pr create --draft --push/,
    );
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.', forge)).not.toMatch(
      /gh pr create/,
    );
    expect(expandCanonicalGitRequest('Ready for review.', forge)).toMatch(/origin pr ready/);
    expect(expandCanonicalGitRequest('Merge PR.', forge)).toMatch(/origin stack merge/);
    expect(expandCanonicalGitRequest('Address review comments.', forge)).toMatch(
      /origin pr view --comments/,
    );
    expect(expandCanonicalGitRequest('Fix CI: lint.', forge)).toMatch(/origin pr checks/);
  });

  it('uses entire trail when the checkout is Entire', () => {
    const forge = { forge: 'entire' as const };
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.', forge)).toMatch(
      /entire trail create --title/,
    );
    expect(expandCanonicalGitRequest('Commit, push, and open a draft PR.', forge)).not.toMatch(
      /gh pr create/,
    );
    expect(expandCanonicalGitRequest('Ready for review.', forge)).toMatch(/entire trail update/);
    expect(expandCanonicalGitRequest('Ready for review.', forge)).not.toMatch(/entire trail approve/);
    expect(expandCanonicalGitRequest('Merge PR.', forge)).toMatch(/entire trail merge/);
    expect(expandCanonicalGitRequest('Address review comments.', forge)).toMatch(
      /entire trail finding list/,
    );
    expect(expandCanonicalGitRequest('Fix CI: lint.', forge)).toMatch(/entire trail merge --dry-run/);
  });

  it('names the base when resolving conflicts', () => {
    const out = expandCanonicalGitRequest(agentGitPrompt('resolve-conflicts', { prBase: 'main' }));
    expect(out).toMatch(/Fetch the PR base \(`main`\)/);
    const intoParent = expandCanonicalGitRequest(
      agentGitPrompt('resolve-conflicts', { prBase: 'matt/parent' }),
    );
    expect(intoParent).toMatch(/origin\/matt\/parent/);
    expect(intoParent).toMatch(/not main\/master/);
    expect(intoParent).toMatch(/Do not merge origin\/main/);
    expect(expandCanonicalGitRequest(agentGitPrompt('resolve-conflicts'))).toMatch(
      /do not assume main/,
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

describe('resolveSidebarGitPrompt', () => {
  it('uses the draft-PR phrase for the primary Create PR button', () => {
    expect(resolveSidebarGitPrompt('create-pr')).toBe(
      'Commit, push, and open a draft PR.',
    );
  });

  it('prefers repository [prompts] create_pr and resolve_merge_conflicts', () => {
    expect(
      resolveSidebarGitPrompt('create-pr', {
        createPr: 'Write a concise PR description with test results.',
      }),
    ).toBe('Write a concise PR description with test results.');
    expect(
      resolveSidebarGitPrompt('create-draft', {
        createPr: '  Open a draft with testers tagged.  ',
      }),
    ).toBe('Open a draft with testers tagged.');
    expect(
      resolveSidebarGitPrompt('resolve-conflicts', {
        prBase: 'main',
        resolveMergeConflicts: 'Keep ours unless theirs is clearly newer.',
      }),
    ).toBe('Keep ours unless theirs is clearly newer.');
  });

  it('falls back to the canonical phrase when an override is blank', () => {
    expect(resolveSidebarGitPrompt('merge', { createPr: 'unused' })).toBe(
      'Merge PR.',
    );
    expect(
      resolveSidebarGitPrompt('merge', { prBase: 'main', createPr: 'unused' }),
    ).toBe('Merge PR.');
    expect(resolveSidebarGitPrompt('merge', { prBase: 'release/1.2' })).toBe(
      'Merge PR into release/1.2.',
    );
    expect(
      resolveSidebarGitPrompt('create-web', { createPr: '   ' }),
    ).toBe('Commit, push, and open a PR in the browser.');
  });
});
