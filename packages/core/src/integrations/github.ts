import { run } from '../git/run.js';

export interface GitHubStatus {
  connected: boolean;
  login: string | null;
  /** Hosts reported by `gh auth status` (usually github.com). */
  hosts: string[];
  /** Human-readable summary when disconnected. */
  reason: string | null;
}

/**
 * Machine-global GitHub auth via the `gh` CLI (same path Sideboard uses for PRs).
 */
export async function getGitHubStatus(): Promise<GitHubStatus> {
  const which = await run('which', ['gh'], { reject: false });
  if (which.exitCode !== 0 || !which.stdout.trim()) {
    return {
      connected: false,
      login: null,
      hosts: [],
      reason: 'gh CLI not found on PATH',
    };
  }

  // Prefer structured login; fall back to auth status parsing.
  const loginResult = await run(
    'gh',
    ['api', 'user', '--jq', '.login'],
    { reject: false },
  );
  if (loginResult.exitCode === 0 && loginResult.stdout.trim()) {
    return {
      connected: true,
      login: loginResult.stdout.trim(),
      hosts: ['github.com'],
      reason: null,
    };
  }

  const status = await run('gh', ['auth', 'status'], { reject: false });
  const text = `${status.stdout}\n${status.stderr}`;
  const loginMatch = text.match(/Logged in to ([^\s]+) account (\S+)/i)
    ?? text.match(/Logged in to ([^\s]+) as (\S+)/i);
  if (loginMatch) {
    return {
      connected: true,
      login: loginMatch[2]!.replace(/['"]/g, ''),
      hosts: [loginMatch[1]!],
      reason: null,
    };
  }

  return {
    connected: false,
    login: null,
    hosts: [],
    reason: status.stderr.trim() || status.stdout.trim() || 'Not logged in to GitHub (run: gh auth login)',
  };
}

/** Open interactive `gh auth login` in a terminal-friendly way (caller may spawn UI). */
export async function refreshGitHubAuth(): Promise<GitHubStatus> {
  // Re-check only — interactive login is opened by the desktop shell.
  return getGitHubStatus();
}
