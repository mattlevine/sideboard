/** Canonical git prompts the desktop buttons and orchestration `ask_git` send. */

export const AGENT_GIT_ACTIONS = [
  'commit-push',
  'create-draft',
  'create-web',
  'resolve-conflicts',
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
    case 'merge':
      return 'Merge PR.';
  }
}
