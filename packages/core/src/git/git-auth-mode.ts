import type { GithubGitAuthMode } from '../store/app-settings.js';

const HTTPS_REWRITE: Array<{ key: string; value: string }> = [
  { key: 'url.https://github.com/.insteadOf', value: 'git@github.com:' },
  { key: 'url.https://github.com/.insteadOf', value: 'ssh://git@github.com/' },
  { key: 'credential.https://github.com.helper', value: '!gh auth git-credential' },
];

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Append `GIT_CONFIG_KEY_n` / `VALUE_n` entries without clobbering inherited
 * command-scoped git config (enterprise insteadOf, custom certs, …).
 */
export function appendIndexedGitConfig(
  existing: EnvLike | undefined,
  entries: Array<{ key: string; value: string }>,
): Record<string, string> {
  const start = Number.parseInt(String(existing?.GIT_CONFIG_COUNT ?? '0'), 10);
  const count = Number.isFinite(start) && start > 0 ? start : 0;
  const out: Record<string, string> = {};
  entries.forEach((entry, i) => {
    const n = count + i;
    out[`GIT_CONFIG_KEY_${n}`] = entry.key;
    out[`GIT_CONFIG_VALUE_${n}`] = entry.value;
  });
  out.GIT_CONFIG_COUNT = String(count + entries.length);
  return out;
}

/**
 * Rewrite GitHub SSH remotes to HTTPS and let `gh` supply credentials.
 * GUI / agent shells often have no ssh-agent; `gh` keyring still works.
 */
export function githubAgentGitEnv(existing?: EnvLike): Record<string, string> {
  return appendIndexedGitConfig(existing, HTTPS_REWRITE);
}

/**
 * Extra env for a worktree agent given Account → GitHub git-auth mode.
 * Does not set `GH_REPO` (caller adds that after resolving origin).
 */
export function applyGithubGitAuthEnv(
  existing: EnvLike | undefined,
  opts: { mode: GithubGitAuthMode; token?: string | null },
): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.mode === 'gh' || opts.mode === 'token') {
    Object.assign(out, githubAgentGitEnv(existing));
  }
  if (opts.mode === 'token') {
    const token = opts.token?.trim();
    if (token && !existing?.GH_TOKEN?.trim()) {
      out.GH_TOKEN = token;
    }
  }
  return out;
}

/** Injected prompt block so agents use the same git path as Sideboard. */
export function formatGitAuthModeDirective(mode: GithubGitAuthMode): string {
  switch (mode) {
    case 'gh':
      return [
        'Git authentication (Account → GitHub mode: gh CLI):',
        '- This process rewrites `git@github.com:` and `ssh://git@github.com/` to HTTPS.',
        '- `gh` supplies credentials (`gh auth git-credential`). Do not switch remotes to SSH.',
        '- Push with `git push -u origin HEAD`. Create/update PRs with `gh` as below.',
      ].join('\n');
    case 'ssh':
      return [
        'Git authentication (Account → GitHub mode: SSH):',
        '- Keep SSH remotes (`git@github.com:…`). Do not rewrite them to HTTPS.',
        '- Use this Mac’s SSH agent / keys. If push fails with `Permission denied (publickey)`, tell the user to start ssh-agent or switch Account → GitHub to Auto / gh CLI — do not rewrite remotes yourself.',
        '- Push with `git push -u origin HEAD`. Create/update PRs with `gh` as below (API still uses `gh`).',
      ].join('\n');
    case 'token':
      return [
        'Git authentication (Account → GitHub mode: personal access token):',
        '- This process rewrites GitHub SSH remotes to HTTPS.',
        '- `GH_TOKEN` is set in the environment. Use HTTPS git and `gh`; do not paste the token into commands or chat.',
        '- Push with `git push -u origin HEAD`. Create/update PRs with `gh` as below.',
      ].join('\n');
    case 'auto':
    default:
      return [
        'Git authentication (Account → GitHub mode: auto):',
        '- Prefer the existing remote URL (SSH or HTTPS). Do not rewrite remotes unless a push/fetch fails.',
        '- If `git push` fails with `Permission denied (publickey)`, this shell has no ssh-agent. Retry over HTTPS (do not stop): `git -c url.https://github.com/.insteadOf=git@github.com: -c http.extraHeader="AUTHORIZATION: bearer $(gh auth token)" push -u origin HEAD`.',
        '- Then create/update the PR with `gh` as below.',
      ].join('\n');
  }
}
