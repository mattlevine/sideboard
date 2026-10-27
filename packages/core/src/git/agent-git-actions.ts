import type { GitForge } from './remote-forge.js';

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

/** Desktop right-sidebar git buttons, including the primary Create PR action. */
export type SidebarGitAction = AgentGitAction | 'create-pr';

function namedPrBase(prBase?: string | null): string | null {
  const base = prBase?.trim().replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  return base || null;
}

/** GitHub default-branch names used in the merge expansion / "never push to main" rules. */
function isMainishPrBase(base: string): boolean {
  const n = base.toLowerCase();
  return n === 'main' || n === 'master';
}

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
      const base = namedPrBase(opts?.prBase);
      const named = base ? ` (${base})` : '';
      return `Merge the remote branch${named} into your branch and resolve conflicts. Then, commit and push your changes.`;
    }
    case 'ready-for-review':
      return 'Ready for review.';
    case 'merge': {
      const base = namedPrBase(opts?.prBase);
      if (base && !isMainishPrBase(base)) {
        return `Merge PR into ${base}.`;
      }
      return 'Merge PR.';
    }
  }
}

/**
 * Prompt text for a sidebar / `ask_git` action. Repository `[prompts]`
 * overrides (`create_pr`, `resolve_merge_conflicts`) win when set.
 */
export function resolveSidebarGitPrompt(
  action: SidebarGitAction,
  opts?: {
    prBase?: string | null;
    createPr?: string | null;
    resolveMergeConflicts?: string | null;
  },
): string {
  if (
    action === 'create-pr' ||
    action === 'create-draft' ||
    action === 'create-web'
  ) {
    const custom = opts?.createPr?.trim();
    if (custom) return custom;
    return agentGitPrompt(action === 'create-pr' ? 'create-draft' : action);
  }
  if (action === 'resolve-conflicts') {
    const custom = opts?.resolveMergeConflicts?.trim();
    if (custom) return custom;
    return agentGitPrompt('resolve-conflicts', opts);
  }
  return agentGitPrompt(action, opts);
}

const RESOLVE_CONFLICTS_RE =
  /^Merge the remote branch(?: \(([^)]+)\))? into your branch and resolve conflicts\. Then, commit and push your changes\.$/;

const MERGE_INTO_RE = /^Merge PR into (.+)\.$/;

/**
 * What each canonical phrase means for the worktree agent. Sent with the
 * request itself (only when that phrase is used) instead of listing every
 * phrase in the fresh-session playbook.
 */
function gitActionExpansion(
  action: AgentGitAction,
  base: string | null,
  forge: GitForge | null | undefined,
): string {
  if (forge === 'cursor') return cursorGitActionExpansion(action, base);
  if (forge === 'entire') return entireGitActionExpansion(action, base);
  switch (action) {
    case 'commit-push':
      return 'Commit any uncommitted work with a purpose-stating message, then push to origin (`git push -u origin HEAD`; this updates an existing PR when one is linked). Do not start a checks loop unless a goal was given.';
    case 'create-draft':
      return 'Commit, push, then create a draft PR with `gh pr create --draft --assignee @me -R <origin-owner/name>` (title/body from the change purpose). Update the existing PR instead if one is linked. Use a different `--assignee` only if the user named someone else.';
    case 'create-web':
      return 'Commit, push, then `gh pr create --web --assignee @me -R <origin-owner/name>`. Use a different `--assignee` only if the user named someone else.';
    case 'resolve-conflicts':
      if (base && !isMainishPrBase(base)) {
        return `Fetch \`origin/${base}\` (this PR's base — not main/master), merge it into this branch, resolve conflicts carefully, then commit and push until the PR is mergeable. Do not merge origin/main.`;
      }
      if (base) {
        return `Fetch the PR base (\`${base}\`), merge it into this branch, resolve conflicts carefully, then commit and push until the PR is mergeable.`;
      }
      return 'Look up this PR\'s base with `gh pr view --json baseRefName` and merge that remote branch into this branch (do not assume main). Resolve conflicts carefully, then commit and push until the PR is mergeable.';
    case 'ready-for-review':
      return 'This phrase is the explicit ask to mark this thread\'s draft pull request ready for review on GitHub (`gh pr ready -R <origin-owner/name>` or `gh pr ready`). Update title/body if the purpose drifted. Do not merge.';
    case 'merge':
      if (base && !isMainishPrBase(base)) {
        return `This phrase is the explicit ask to merge this thread's open pull request into \`${base}\` on GitHub with \`gh pr merge\` (respect repo defaults / squash vs merge). This PR targets \`${base}\`, not main — do not use \`gh stack merge\` and do not retarget or merge into main/master. Do not force-push main/master or merge locally into the main checkout.`;
      }
      return 'This phrase is the explicit ask to merge this thread\'s open pull request on GitHub. If `gh stack view` shows a stack, use `gh stack merge`; otherwise `gh pr merge` (respect repo defaults / squash vs merge). Do not force-push main/master or merge locally into the main checkout.';
  }
}

/**
 * When a turn prompt is exactly one of the canonical desktop / `ask_git`
 * phrases, append its expansion so the agent acts without asking. Free-form
 * prompts pass through unchanged.
 */
function cursorGitActionExpansion(action: AgentGitAction, base: string | null): string {
  switch (action) {
    case 'commit-push':
      return 'Commit any uncommitted work with a purpose-stating message, then push to origin (`git push -u origin HEAD`; this updates an existing PR when one is linked). Use `origin`, not `gh`. Do not start a checks loop unless a goal was given.';
    case 'create-draft':
      return 'Commit, push, then create a draft PR with `origin pr create --draft --push -R <origin-owner/name> --body-file <short.md>` (title/body from the change purpose). Take the URL from `--json url`. Update the existing PR with `origin pr edit` if one is linked. Do not use `gh`.';
    case 'create-web':
      return 'Commit, push, then `origin pr create --push -R <origin-owner/name>` and open the URL from `--json url`. Origin has no `--web` form. Add `--draft` when they asked for a draft. Do not use `gh`.';
    case 'resolve-conflicts':
      if (base && !isMainishPrBase(base)) {
        return `Fetch \`origin/${base}\` (this PR's base — not main/master), merge it into this branch, resolve conflicts carefully, then commit and push until the PR is mergeable. Do not merge origin/main.`;
      }
      if (base) {
        return `Fetch the PR base (\`${base}\`), merge it into this branch, resolve conflicts carefully, then commit and push until the PR is mergeable.`;
      }
      return 'Look up this PR\'s base with `origin pr view --json baseRefName` and merge that remote branch into this branch (do not assume main). Resolve conflicts carefully, then commit and push until the PR is mergeable. Do not use `gh`.';
    case 'ready-for-review':
      return 'This phrase is the explicit ask to mark this thread\'s draft pull request ready for review on Cursor (`origin pr ready -R <origin-owner/name>`). Update title/body if the purpose drifted. Do not merge. Do not use `gh`.';
    case 'merge':
      if (base && !isMainishPrBase(base)) {
        return `This phrase is the explicit ask to merge this thread's open pull request into \`${base}\` on Cursor with \`origin pr merge\`. This PR targets \`${base}\`, not main — do not use \`origin stack merge\` and do not retarget or merge into main/master. Do not force-push main/master or merge locally into the main checkout. Do not use \`gh\`.`;
      }
      return 'This phrase is the explicit ask to merge this thread\'s open pull request on Cursor. If `origin stack view` shows a stack, use `origin stack merge`; otherwise `origin pr merge`. Do not force-push main/master or merge locally into the main checkout. Do not use `gh`.';
  }
}

function entireGitActionExpansion(action: AgentGitAction, base: string | null): string {
  switch (action) {
    case 'commit-push':
      return 'Commit any uncommitted work with a purpose-stating message, then push to origin (`git push -u origin HEAD`). Use `entire`, not `gh` or `origin`. Do not start a checks loop unless a goal was given.';
    case 'create-draft':
      return 'Commit, push, then open a Trail with `entire trail create --title "<title>" --body "<short>"` (title/body from the change purpose). Take the URL from `--json`. If this branch already has a trail, `entire trail update` instead of creating another. Trails have no draft flag. Do not use `gh` or `origin`.';
    case 'create-web':
      return 'Commit, push, then `entire trail create --title "<title>" --body "<short>"` and open the URL from `--json`. Entire has no `--web` form. Do not use `gh` or `origin`.';
    case 'resolve-conflicts':
      if (base && !isMainishPrBase(base)) {
        return `Fetch \`origin/${base}\` (this Trail's base — not main/master), merge it into this branch, resolve conflicts carefully, then commit and push. Do not merge origin/main.`;
      }
      if (base) {
        return `Fetch the Trail base (\`${base}\`), merge it into this branch, resolve conflicts carefully, then commit and push.`;
      }
      return 'Look up this Trail\'s base with `entire trail show --json` and merge that remote branch into this branch (do not assume main). Resolve conflicts carefully, then commit and push. Do not use `gh`.';
    case 'ready-for-review':
      return 'This phrase means the Trail should be ready for a person to review. Trails have no draft flag and start open. Update title or body with `entire trail update` if the purpose drifted. Do not approve the trail and do not merge. Do not use `gh`.';
    case 'merge':
      if (base && !isMainishPrBase(base)) {
        return `This phrase is the explicit ask to merge this thread's Trail change into \`${base}\` with \`entire trail merge\`. This change targets \`${base}\`, not main — do not retarget or merge into main/master. Do not force-push main/master or merge locally into the main checkout. Do not use \`gh\`.`;
      }
      return 'This phrase is the explicit ask to merge this thread\'s Trail change with `entire trail merge`. Do not force-push main/master or merge locally into the main checkout. Do not use `gh`.';
  }
}

export function expandCanonicalGitRequest(
  prompt: string,
  opts?: { forge?: GitForge | null },
): string {
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
  if (!action) {
    const m = MERGE_INTO_RE.exec(trimmed);
    if (m) {
      action = 'merge';
      base = m[1]?.trim() || null;
    }
  }
  const forge = opts?.forge ?? null;
  let expansion: string | null = action ? gitActionExpansion(action, base, forge) : null;
  // PR sidebar buttons (not ask_git actions).
  if (!expansion && trimmed === 'Address review comments.') {
    expansion =
      forge === 'cursor'
        ? 'Read the PR review feedback (`origin pr view --comments`, `origin pr thread list`), make the requested changes, commit, and push. Do not use `gh`.'
        : forge === 'entire'
          ? 'Read open findings (`entire trail finding list`), make the requested changes, commit, and push. Do not use `gh` or `entire trail comment` (agent sessions cannot post trail comments).'
          : 'Read the PR review feedback (`gh pr view --comments`, `gh api` review comments), make the requested changes, commit, and push.';
  } else if (!expansion && FIX_CI_RE.test(trimmed)) {
    expansion =
      forge === 'cursor'
        ? 'Investigate that failing check (`origin pr checks`, `origin pr watch`), fix it, commit, and push. Loop only if a goal to keep going until it passes was given. Do not use `gh run`.'
        : forge === 'entire'
          ? 'Investigate the blocking gate (`entire trail merge --dry-run`, `entire trail finding list`, `entire trail watch`), fix it, commit, and push. Loop only if a goal to keep going until it passes was given. Do not use `gh run`.'
          : 'Investigate that failing check (`gh pr checks`, `gh run view --log-failed`), fix it, commit, and push. Loop only if a goal to keep going until it passes was given.';
  }
  if (!expansion) return prompt;
  return `${trimmed}\n\n(Sideboard git request — do not ask for clarification: ${expansion})`;
}

const FIX_CI_RE = /^Fix CI: .+\.$/;
