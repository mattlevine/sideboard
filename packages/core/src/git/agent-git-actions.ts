/** Canonical git prompts the desktop buttons and orchestration `ask_git` send. */

export const AGENT_GIT_ACTIONS = [
  'commit-push',
  'create-draft',
  'create-web',
  'resolve-conflicts',
  'ready-for-review',
  'merge',
] as const;

export type AgentGitAction = (typeof AGENT_GIT_ACTIONS)[number];

export function agentGitPrompt(
  action: AgentGitAction,
  opts?: { prBase?: string | null },
): string {
  switch (action) {
    case 'commit-push':
      return 'Commit and push.';
    case 'create-draft':
      return 'Commit, push, and open a draft PR.';
    case 'create-web':
      return 'Commit, push, and open a PR in the browser.';
    case 'resolve-conflicts': {
      const base = opts?.prBase?.trim().replace(/^refs\/heads\//, '');
      const named = base ? ` (${base})` : '';
      return `Merge the remote branch${named} into your branch and resolve conflicts. Then, commit and push your changes.`;
    }
    case 'ready-for-review':
      return 'Ready for review.';
    case 'merge':
      return 'Merge PR.';
  }
}

const RESOLVE_CONFLICTS_RE =
  /^Merge the remote branch(?: \(([^)]+)\))? into your branch and resolve conflicts\. Then, commit and push your changes\.$/;

/**
 * What each canonical phrase means for the worktree agent. Sent with the
 * request itself (only when that phrase is used) instead of listing every
 * phrase in the fresh-session playbook.
 */
function gitActionExpansion(action: AgentGitAction, base: string | null): string {
  switch (action) {
    case 'commit-push':
      return 'Commit any uncommitted work with a purpose-stating message, then push to origin (`git push -u origin HEAD`; this updates an existing PR when one is linked). Do not start a checks loop unless a goal was given.';
    case 'create-draft':
      return 'Commit, push, then create a draft PR with `gh pr create --draft -R <origin-owner/name>` (title/body from the change purpose). Update the existing PR instead if one is linked.';
    case 'create-web':
      return 'Commit, push, then `gh pr create --web -R <origin-owner/name>`.';
    case 'resolve-conflicts':
      return `Fetch the PR base${base ? ` (\`${base}\`)` : ''}, merge it into this branch, resolve conflicts carefully, then commit and push until the PR is mergeable.`;
    case 'ready-for-review':
      return 'This phrase is the explicit ask to mark this thread\'s draft pull request ready for review on GitHub (`gh pr ready -R <origin-owner/name>` or `gh pr ready`). Update title/body if the purpose drifted. Do not merge.';
    case 'merge':
      return 'This phrase is the explicit ask to merge this thread\'s open pull request on GitHub. If `gh stack view` shows a stack, use `gh stack merge`; otherwise `gh pr merge` (respect repo defaults / squash vs merge). Do not force-push main/master or merge locally into the main checkout.';
  }
}

/**
 * When a turn prompt is exactly one of the canonical desktop / `ask_git`
 * phrases, append its expansion so the agent acts without asking. Free-form
 * prompts pass through unchanged.
 */
export function expandCanonicalGitRequest(prompt: string): string {
  const trimmed = prompt.trim();
  let action: AgentGitAction | null = null;
  let base: string | null = null;
  for (const candidate of AGENT_GIT_ACTIONS) {
    if (candidate === 'resolve-conflicts') continue;
    if (agentGitPrompt(candidate) === trimmed) {
      action = candidate;
      break;
    }
  }
  if (!action) {
    const m = RESOLVE_CONFLICTS_RE.exec(trimmed);
    if (m) {
      action = 'resolve-conflicts';
      base = m[1] ?? null;
    }
  }
  let expansion: string | null = action ? gitActionExpansion(action, base) : null;
  // PR sidebar buttons (not ask_git actions).
  if (!expansion && trimmed === 'Address review comments.') {
    expansion =
      'Read the PR review feedback (`gh pr view --comments`, `gh api` review comments), make the requested changes, commit, and push.';
  } else if (!expansion && FIX_CI_RE.test(trimmed)) {
    expansion =
      'Investigate that failing check (`gh pr checks`, `gh run view --log-failed`), fix it, commit, and push. Loop only if a goal to keep going until it passes was given.';
  }
  if (!expansion) return prompt;
  return `${trimmed}\n\n(Sideboard git request — do not ask for clarification: ${expansion})`;
}

const FIX_CI_RE = /^Fix CI: .+\.$/;
