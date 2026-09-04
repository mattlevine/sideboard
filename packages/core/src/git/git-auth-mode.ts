import { isAbsolute } from 'node:path';
import { getGithubGitAuthMode, getGithubPat, type GithubGitAuthMode } from '../store/app-settings.js';
import {
  githubAgentAuthDir,
  githubAgentAuthReady,
  githubCredentialHelperGitConfig,
  githubGhConfigEnv,
  materializeGithubAgentAuth,
} from './github-agent-auth.js';
import { git, resolveGhAuthToken } from './run.js';

const HTTPS_REWRITE: Array<{ key: string; value: string }> = [
  { key: 'url.https://github.com/.insteadOf', value: 'git@github.com:' },
  { key: 'url.https://github.com/.insteadOf', value: 'ssh://git@github.com/' },
];

/**
 * Process-only `insteadOf` so `git@` / `ssh://` / host-alias remotes speak
 * HTTPS without editing the stored remote. `-c url.*.insteadOf` can only hold
 * one value; callers must apply these via {@link appendIndexedGitConfig}.
 */
export function githubHttpsInsteadOfEntries(
  remoteUrl?: string | null,
): Array<{ key: string; value: string }> {
  const entries = [...HTTPS_REWRITE];
  const url = remoteUrl?.trim() ?? '';
  const scpAlias = url.match(/^(git@github\.com-[^:]+):/i);
  if (scpAlias?.[1]) {
    entries.push({
      key: 'url.https://github.com/.insteadOf',
      value: `${scpAlias[1]}:`,
    });
  }
  const sshAlias = url.match(/^ssh:\/\/git@(github\.com-[^/]+)\//i);
  if (sshAlias?.[1]) {
    entries.push({
      key: 'url.https://github.com/.insteadOf',
      value: `ssh://git@${sshAlias[1]}/`,
    });
  }
  return entries;
}

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
let tokenMemo: { mode: GithubGitAuthMode; value: string | null; at: number } | null =
  null;

const GITHUB_CHILD_TOKEN_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
] as const;

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
 * When Sideboard has warmed a credential store, git uses that file instead of
 * embedding a token in env.
 */
export function githubAgentGitEnv(
  existing?: EnvLike,
  opts?: { remoteUrl?: string | null },
): Record<string, string> {
  const helpers = githubAgentAuthReady()
    ? githubCredentialHelperGitConfig()
    : [{ key: 'credential.helper', value: '' }];
  return appendIndexedGitConfig(existing, [
    ...githubHttpsInsteadOfEntries(opts?.remoteUrl),
    ...helpers,
  ]);
}

/**
 * Extra env for a worktree agent given Settings → Git git-auth mode.
 * Does not set `GH_REPO` (caller adds that after resolving origin).
 *
 * Token is written to a 0600 credential store + isolated `GH_CONFIG_DIR` in
 * the Sideboard parent. Agent env does **not** include `GH_TOKEN` or a bearer
 * extraHeader (those show up in `env` dumps and in Cursor's "don't expose
 * tokens" guidance).
 */
export function applyGithubGitAuthEnv(
  existing: EnvLike | undefined,
  opts: { mode: GithubGitAuthMode; token?: string | null },
): Record<string, string> {
  const out: Record<string, string> = { ...nonInteractiveGitProcessEnv() };
  const token = (opts.token?.trim() || existing?.GH_TOKEN?.trim() || '') || '';
  if (token) materializeGithubAgentAuth(token);
  Object.assign(out, githubGhConfigEnv());
  // SSH-only (no gh/PAT): keep remotes on SSH. When a token exists, still
  // rewrite in-process so ask_git / Electron can push without ssh-agent.
  if (opts.mode === 'ssh' && !token) return out;
  Object.assign(out, githubAgentGitEnv(existing));
  return out;
}

/** Drop inherited GitHub tokens so agents never see them in `env`. */
export function scrubGithubTokensFromChildEnv(
  env: Record<string, string | undefined> | NodeJS.ProcessEnv,
): void {
  for (const key of GITHUB_CHILD_TOKEN_KEYS) {
    delete env[key];
  }
}

/** Merge warmed git/gh env onto a child env and strip token variables. */
export function mergeAgentGitAuthEnv(
  env: Record<string, string | undefined> | NodeJS.ProcessEnv,
  gitEnv: Record<string, string>,
): void {
  Object.assign(env, gitEnv);
  scrubGithubTokensFromChildEnv(env);
}

/**
 * PAT or `gh auth token`, resolved in the Sideboard parent (not the agent).
 * SSH mode still returns a gh token so `gh pr` works; git remotes stay SSH.
 */
export async function resolveGithubAgentToken(
  mode: GithubGitAuthMode,
  cwd: string,
): Promise<string | null> {
  if (tokenMemo && tokenMemo.mode === mode && Date.now() - tokenMemo.at < TOKEN_TTL_MS) {
    return tokenMemo.value;
  }
  let value: string | null = null;
  if (mode === 'token') {
    value = getGithubPat();
  } else {
    try {
      value = await resolveGhAuthToken(cwd);
    } catch {
      value = null;
    }
  }
  tokenMemo = { mode, value, at: Date.now() };
  return value;
}

/** Test helper — process-local token memo (avoids Keychain on every spawn). */
export function resetGithubAgentTokenMemo(): void {
  tokenMemo = null;
}

/**
 * Non-interactive GitHub env for agent / MCP children (HTTPS + warmed helper).
 * Safe to call without a git checkout (`cwd` only needed for `gh`).
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
 * Warm Keychain/`gh` once. Desktop startup uses `{ force: true }` (Keychain
 * is OK then). MCP/CLI skip when credential files already exist so a nested
 * MCP process does not prompt Keychain on every agent turn.
 */
export async function warmGithubAgentAuth(opts?: {
  cwd?: string;
  force?: boolean;
}): Promise<void> {
  if (!opts?.force && githubAgentAuthReady()) return;
  await resolveAgentGitAuthEnv(undefined, opts);
}

function normalizeWritableRoot(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed && isAbsolute(trimmed) ? trimmed : null;
}

/**
 * Codex workspace-write mounts `.git` read-only unless `writable_roots` names
 * the gitdir itself. Linked worktrees store `index.lock` under the main
 * repo’s `.git/worktrees/<name>/`, which is outside `--cd`.
 */
export async function resolveCodexGitWritableRoots(cwd: string): Promise<string[]> {
  const roots = new Set<string>();
  const authDir = normalizeWritableRoot(githubAgentAuthDir());
  if (authDir) roots.add(authDir);

  try {
    const [gitDir, commonDir] = await Promise.all([
      git(['rev-parse', '--absolute-git-dir'], cwd, { reject: false, timeoutMs: 5_000 }),
      git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, {
        reject: false,
        timeoutMs: 5_000,
      }),
    ]);
    const gitDirPath = gitDir.exitCode === 0 ? normalizeWritableRoot(gitDir.stdout) : null;
    const commonPath =
      commonDir.exitCode === 0 ? normalizeWritableRoot(commonDir.stdout) : null;
    if (gitDirPath) roots.add(gitDirPath);
    if (commonPath) roots.add(commonPath);
  } catch {
    /* cwd may not be a git checkout (tests, global orchestrator) */
  }
  return [...roots];
}

export function codexSandboxWritableRootsArgs(roots: string[]): string[] {
  const abs = [...new Set(roots.map(normalizeWritableRoot).filter(Boolean))] as string[];
  if (abs.length === 0) return [];
  return ['-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(abs)}`];
}

export function codexUnattendedGitConfigArgs(
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' | string,
  opts?: { writableRoots?: string[] },
): string[] {
  const args = [
    '-c',
    'shell_environment_policy.inherit="all"',
    '-c',
    'shell_environment_policy.ignore_default_excludes=true',
  ];
  if (sandbox === 'workspace-write') {
    args.push('-c', 'sandbox_workspace_write.network_access=true');
    args.push(...codexSandboxWritableRootsArgs(opts?.writableRoots ?? []));
  }
  return args;
}

/** Injected prompt block so agents use git/gh without hunting for tokens. */
export function formatGitAuthModeDirective(mode: GithubGitAuthMode): string {
  const shared = [
    '- `git` and `gh` already authenticate in this process. Do not look for tokens in the environment, paste credentials into commands, or switch remotes to SSH.',
    '- Do not set GitHub token environment variables, pass `--with-token`, or run `gh auth login` from this turn.',
    '- Push with `git push -u origin HEAD`. Create/update PRs with `gh` as below.',
    '- If git/gh fail with auth errors, tell the user to run `gh auth login` on this Mac (or set a PAT in Settings → Git). Do not wait for a Keychain dialog.',
  ];
  switch (mode) {
    case 'gh':
      return [
        'Git authentication (Settings → Git mode: gh CLI):',
        '- This process rewrites `git@github.com:` and `ssh://git@github.com/` to HTTPS.',
        ...shared,
      ].join('\n');
    case 'ssh':
      return [
        'Git authentication (Settings → Git mode: SSH):',
        '- Stored remotes stay SSH (`git@github.com:…`). Do not `git remote set-url` or rewrite them to HTTPS.',
        '- This process may push over HTTPS via `gh` (process-only `insteadOf`) so ask_git / unattended turns work when ssh-agent is missing — that does not change the stored remote.',
        '- SSH is batch-mode: it will not prompt for a Keychain password. If both SSH and HTTPS fail, tell the user to unlock ssh-agent or run `gh auth login` (or switch Settings → Git to Auto).',
        '- `gh` already authenticates for PRs/API (no token in the environment). Do not set GitHub token environment variables or run `gh auth login` from this turn.',
        '- Push with `git push -u origin HEAD`. Create/update PRs with `gh` as below.',
      ].join('\n');
    case 'token':
      return [
        'Git authentication (Settings → Git mode: personal access token):',
        '- This process rewrites GitHub SSH remotes to HTTPS.',
        ...shared,
      ].join('\n');
    case 'auto':
    default:
      return [
        'Git authentication (Settings → Git mode: auto):',
        '- This process rewrites GitHub SSH remotes to HTTPS so git/ssh never prompt the macOS Keychain (required for unattended orchestrator turns).',
        ...shared,
      ].join('\n');
  }
}
