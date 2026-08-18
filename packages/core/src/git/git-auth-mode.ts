import { getGithubGitAuthMode, getGithubPat, type GithubGitAuthMode } from '../store/app-settings.js';
import { resolveGhAuthToken } from './run.js';

const HTTPS_REWRITE: Array<{ key: string; value: string }> = [
  { key: 'url.https://github.com/.insteadOf', value: 'git@github.com:' },
  { key: 'url.https://github.com/.insteadOf', value: 'ssh://git@github.com/' },
  // Empty helper disables ~/.gitconfig osxkeychain so GUI agents cannot pop
  // "git-credential-osxkeychain wants to use the keychain".
  { key: 'credential.helper', value: '' },
];

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Fail closed instead of a macOS Keychain / SSH passphrase dialog.
 * Orchestrator parents (desktop Global, MCP, Slack) cannot click those prompts.
 */
export function nonInteractiveGitProcessEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: process.env.GIT_ASKPASS?.trim() || 'echo',
    SSH_ASKPASS: process.env.SSH_ASKPASS?.trim() || 'echo',
    GIT_SSH_COMMAND:
      process.env.GIT_SSH_COMMAND?.trim() || 'ssh -o BatchMode=yes -o ConnectTimeout=15',
    GCM_INTERACTIVE: 'never',
    GH_PROMPT_DISABLED: '1',
  };
}

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
 * Rewrite GitHub SSH remotes to HTTPS for this process only (does not edit
 * the stored remote). Credential helper is cleared so osxkeychain cannot prompt.
 */
export function githubAgentGitEnv(existing?: EnvLike): Record<string, string> {
  return appendIndexedGitConfig(existing, HTTPS_REWRITE);
}

function githubHttpsBearerEnv(existing: EnvLike | undefined, token: string): Record<string, string> {
  const rewrite = githubAgentGitEnv(existing);
  const header = appendIndexedGitConfig(
    { ...existing, ...rewrite },
    [
      {
        key: 'http.https://github.com/.extraHeader',
        value: `AUTHORIZATION: bearer ${token}`,
      },
    ],
  );
  return { ...rewrite, ...header };
}

/**
 * Extra env for a worktree agent given Account → GitHub git-auth mode.
 * Does not set `GH_REPO` (caller adds that after resolving origin).
 *
 * `auto` and `gh` rewrite to HTTPS in-process and inject `GH_TOKEN` when
 * provided so unattended agents never talk to the login keychain.
 */
export function applyGithubGitAuthEnv(
  existing: EnvLike | undefined,
  opts: { mode: GithubGitAuthMode; token?: string | null },
): Record<string, string> {
  const out: Record<string, string> = { ...nonInteractiveGitProcessEnv() };
  if (opts.mode === 'ssh') return out;

  const existingToken = existing?.GH_TOKEN?.trim() || '';
  const provided = existingToken ? '' : opts.token?.trim() || '';
  const token = existingToken || provided;
  Object.assign(
    out,
    token ? githubHttpsBearerEnv(existing, token) : githubAgentGitEnv(existing),
  );
  if (provided) out.GH_TOKEN = provided;
  return out;
}

/** PAT or `gh auth token`, resolved in the Sideboard parent (not the agent). */
export async function resolveGithubAgentToken(
  mode: GithubGitAuthMode,
  cwd: string,
): Promise<string | null> {
  if (mode === 'ssh') return null;
  if (mode === 'token') return getGithubPat();
  try {
    return await resolveGhAuthToken(cwd);
  } catch {
    return null;
  }
}

/**
 * Non-interactive GitHub env for agent / MCP children (HTTPS + token when
 * possible). Safe to call without a git checkout (`cwd` only needed for `gh`).
 * Always returns at least {@link nonInteractiveGitProcessEnv} — settings/vault
 * failures must not skip Keychain suppression.
 */
export async function resolveAgentGitAuthEnv(
  existing?: EnvLike,
  opts?: { cwd?: string; mode?: GithubGitAuthMode },
): Promise<Record<string, string>> {
  let mode: GithubGitAuthMode = 'auto';
  if (opts?.mode) {
    mode = opts.mode;
  } else {
    try {
      mode = getGithubGitAuthMode();
    } catch {
      mode = 'auto';
    }
  }
  const cwd = opts?.cwd?.trim() || process.cwd();
  let token: string | null = null;
  try {
    token = await resolveGithubAgentToken(mode, cwd);
  } catch {
    token = null;
  }
  return applyGithubGitAuthEnv(existing, { mode, token });
}

/**
 * Codex `exec -c` so sandboxed shells keep Sideboard’s git env.
 * Default `shell_environment_policy` drops `*TOKEN*` / `*KEY*` and
 * `workspace-write` has no network — both force `gh`/git onto Keychain or a hang.
 */
export function codexUnattendedGitConfigArgs(
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' | string,
): string[] {
  const args = [
    '-c',
    'shell_environment_policy.inherit="all"',
    '-c',
    'shell_environment_policy.ignore_default_excludes=true',
  ];
  if (sandbox === 'workspace-write') {
    args.push('-c', 'sandbox_workspace_write.network_access=true');
  }
  return args;
}

/** Injected prompt block so agents use the same git path as Sideboard. */
export function formatGitAuthModeDirective(mode: GithubGitAuthMode): string {
  switch (mode) {
    case 'gh':
      return [
        'Git authentication (Account → GitHub mode: gh CLI):',
        '- This process rewrites `git@github.com:` and `ssh://git@github.com/` to HTTPS.',
        '- `GH_TOKEN` is injected from `gh auth token` (no macOS Keychain prompts). Do not switch remotes to SSH.',
        '- Push with `git push -u origin HEAD`. Create/update PRs with `gh` as below.',
      ].join('\n');
    case 'ssh':
      return [
        'Git authentication (Account → GitHub mode: SSH):',
        '- Keep SSH remotes (`git@github.com:…`). Do not rewrite them to HTTPS.',
        '- SSH is batch-mode: it will not prompt for a Keychain password. If push fails with `Permission denied (publickey)`, tell the user to unlock ssh-agent or switch Account → GitHub to Auto / gh CLI — do not rewrite remotes yourself.',
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
        '- This process rewrites GitHub SSH remotes to HTTPS and authenticates with `GH_TOKEN` from `gh` so git/ssh never prompt the macOS Keychain (required for unattended orchestrator turns).',
        '- Do not switch remotes to SSH. Push with `git push -u origin HEAD`.',
        '- If HTTPS auth fails, tell the user to run `gh auth login` on this Mac or set Account → GitHub to a PAT — do not wait for a Keychain dialog.',
      ].join('\n');
  }
}
