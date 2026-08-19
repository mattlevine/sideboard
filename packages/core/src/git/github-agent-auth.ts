/**
 * GitHub auth for agent children without putting a token in their environment.
 *
 * Warm once at app start (`gh auth token` may unlock the Keychain). After that,
 * agents get a git credential-store file + an isolated `GH_CONFIG_DIR` so
 * `git`/`gh` work and never call osxkeychain. Tokens stay on disk at 0600,
 * not in `GH_TOKEN` / `http.extraHeader` / the prompt.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Override in tests. Default avoids spaces so git `credential.helper` argv stays one token. */
export function githubAgentAuthDir(): string {
  const override = process.env.SIDEBOARD_GIT_AUTH_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.sideboard-git-auth');
}

export function githubCredentialStorePath(): string {
  return join(githubAgentAuthDir(), 'git-credentials');
}

export function githubGhConfigDir(): string {
  return join(githubAgentAuthDir(), 'gh');
}

function writePrivateFile(file: string, body: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(file), 0o700);
  } catch {
    /* best-effort on platforms that ignore chmod */
  }
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

/** `git-credential-store` line. Token is URL-encoded so `@` / `:` cannot break the URL. */
export function gitCredentialStoreContents(token: string): string {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com\n`;
}

/** Isolated gh hosts.yml so `gh` does not read the login Keychain. */
export function ghHostsYml(token: string, user = 'x-access-token'): string {
  const u = user.replace(/[^A-Za-z0-9._-]/g, '') || 'x-access-token';
  return [
    'github.com:',
    '    git_protocol: https',
    `    user: ${u}`,
    `    oauth_token: ${token}`,
    '    users:',
    `        ${u}:`,
    `            oauth_token: ${token}`,
    '',
  ].join('\n');
}

export function materializeGithubAgentAuth(token: string, user?: string): void {
  const trimmed = token.trim();
  if (!trimmed) return;
  const root = githubAgentAuthDir();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    chmodSync(root, 0o700);
  } catch {
    /* ignore */
  }
  writePrivateFile(githubCredentialStorePath(), gitCredentialStoreContents(trimmed));
  const ghDir = githubGhConfigDir();
  mkdirSync(ghDir, { recursive: true, mode: 0o700 });
  writePrivateFile(join(ghDir, 'hosts.yml'), ghHostsYml(trimmed, user));
  writePrivateFile(join(ghDir, 'config.yml'), 'git_protocol: https\nprompt: disabled\n');
}

export function githubAgentAuthReady(): boolean {
  return existsSync(githubCredentialStorePath()) && existsSync(join(githubGhConfigDir(), 'hosts.yml'));
}

/**
 * Indexed git-config entries: disable osxkeychain, then use our store file.
 * Does not embed the token in env.
 */
export function githubCredentialHelperGitConfig(): Array<{ key: string; value: string }> {
  const file = githubCredentialStorePath();
  return [
    { key: 'credential.helper', value: '' },
    { key: 'credential.helper', value: `store --file=${file}` },
  ];
}

/** Non-secret env so `gh` uses the warmed config dir. */
export function githubGhConfigEnv(): Record<string, string> {
  return {
    GH_CONFIG_DIR: githubGhConfigDir(),
    GH_PROMPT_DISABLED: '1',
  };
}

