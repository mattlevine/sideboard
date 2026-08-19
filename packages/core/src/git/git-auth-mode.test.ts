import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendIndexedGitConfig,
  applyGithubGitAuthEnv,
  codexUnattendedGitConfigArgs,
  formatGitAuthModeDirective,
  githubAgentGitEnv,
  mergeAgentGitAuthEnv,
  nonInteractiveGitProcessEnv,
  resetGithubAgentTokenMemo,
} from './git-auth-mode.js';
import { githubCredentialStorePath, githubGhConfigDir } from './github-agent-auth.js';

describe('nonInteractiveGitProcessEnv', () => {
  it('fails closed instead of prompting Keychain or SSH', () => {
    const env = nonInteractiveGitProcessEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBe('echo');
    expect(env.SSH_ASKPASS).toBe('echo');
    expect(env.GIT_SSH_COMMAND).toMatch(/BatchMode=yes/);
    expect(env.GH_PROMPT_DISABLED).toBe('1');
  });
});

describe('appendIndexedGitConfig', () => {
  it('starts at 0 when no inherited GIT_CONFIG_* is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-git-auth-'));
    const prev = process.env.SIDEBOARD_GIT_AUTH_DIR;
    process.env.SIDEBOARD_GIT_AUTH_DIR = dir;
    try {
      expect(githubAgentGitEnv()).toEqual({
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
        GIT_CONFIG_VALUE_0: 'git@github.com:',
        GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
        GIT_CONFIG_VALUE_1: 'ssh://git@github.com/',
        GIT_CONFIG_KEY_2: 'credential.helper',
        GIT_CONFIG_VALUE_2: '',
      });
    } finally {
      if (prev === undefined) delete process.env.SIDEBOARD_GIT_AUTH_DIR;
      else process.env.SIDEBOARD_GIT_AUTH_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends after inherited indexed config', () => {
    const next = appendIndexedGitConfig(
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.sslCAInfo',
        GIT_CONFIG_VALUE_0: '/tmp/corp.pem',
      },
      [{ key: 'url.https://github.com/.insteadOf', value: 'git@github.com:' }],
    );
    expect(next).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_1: 'git@github.com:',
    });
  });
});

describe('applyGithubGitAuthEnv', () => {
  let dir: string;
  const prev = process.env.SIDEBOARD_GIT_AUTH_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sideboard-git-auth-'));
    process.env.SIDEBOARD_GIT_AUTH_DIR = dir;
    resetGithubAgentTokenMemo();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.SIDEBOARD_GIT_AUTH_DIR;
    else process.env.SIDEBOARD_GIT_AUTH_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
    resetGithubAgentTokenMemo();
  });

  it('ssh stays batch-mode and does not rewrite remotes', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'ssh' });
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_SSH_COMMAND).toMatch(/BatchMode=yes/);
    expect(env.GH_CONFIG_DIR).toBe(githubGhConfigDir());
  });

  it('auto rewrites SSH remotes to HTTPS and disables osxkeychain', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'auto' });
    expect(env.GIT_CONFIG_COUNT).toBe('3');
    expect(env.GIT_CONFIG_VALUE_2).toBe('');
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('gh warms a credential store instead of putting the token in env', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'gh', token: 'gho_secret' });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('gho_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('4');
    expect(env.GIT_CONFIG_KEY_2).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_2).toBe('');
    expect(env.GIT_CONFIG_VALUE_3).toBe(`store --file=${githubCredentialStorePath()}`);
    expect(env.GH_CONFIG_DIR).toBe(githubGhConfigDir());
  });

  it('token mode also keeps the PAT out of agent env', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'token', token: 'ghp_secret' });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('ghp_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('4');
  });

  it('uses an existing GH_TOKEN to warm the store but does not re-export it', () => {
    const env = applyGithubGitAuthEnv(
      { GH_TOKEN: 'from-shell' },
      { mode: 'token', token: 'ghp_secret' },
    );
    expect(env.GH_TOKEN).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('from-shell');
    expect(JSON.stringify(env)).not.toContain('ghp_secret');
    expect(env.GIT_CONFIG_VALUE_3).toContain('store --file=');
  });

  it('ssh still warms gh config when a token is available', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'ssh', token: 'gho_secret' });
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GH_CONFIG_DIR).toBe(githubGhConfigDir());
    expect(JSON.stringify(env)).not.toContain('gho_secret');
  });

  it('mergeAgentGitAuthEnv strips inherited GH_TOKEN from the child env', () => {
    const env: Record<string, string | undefined> = {
      GH_TOKEN: 'from-shell',
      GITHUB_TOKEN: 'also-secret',
      PATH: '/usr/bin',
    };
    mergeAgentGitAuthEnv(env, applyGithubGitAuthEnv(env, { mode: 'gh', token: 'gho_secret' }));
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(JSON.stringify(env)).not.toContain('from-shell');
    expect(JSON.stringify(env)).not.toContain('gho_secret');
  });
});

describe('codexUnattendedGitConfigArgs', () => {
  it('keeps GH_CONFIG_DIR / GIT_CONFIG in the sandbox and enables network for workspace-write', () => {
    expect(codexUnattendedGitConfigArgs('workspace-write')).toEqual([
      '-c',
      'shell_environment_policy.inherit="all"',
      '-c',
      'shell_environment_policy.ignore_default_excludes=true',
      '-c',
      'sandbox_workspace_write.network_access=true',
    ]);
  });

  it('does not force network on read-only or full-access', () => {
    const readOnly = codexUnattendedGitConfigArgs('read-only');
    expect(readOnly).not.toContain('sandbox_workspace_write.network_access=true');
    expect(codexUnattendedGitConfigArgs('danger-full-access')).toEqual(readOnly);
  });
});

describe('formatGitAuthModeDirective', () => {
  it('auto tells agents git/gh already work and Keychain must not appear', () => {
    const text = formatGitAuthModeDirective('auto');
    expect(text).toMatch(/mode: auto/);
    expect(text).toMatch(/Keychain/);
    expect(text).toMatch(/already authenticate/);
    expect(text).toMatch(/Do not set GitHub token environment variables/);
    expect(text).not.toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('gh tells agents remotes are rewritten without mentioning tokens', () => {
    const text = formatGitAuthModeDirective('gh');
    expect(text).toMatch(/mode: gh CLI/);
    expect(text).toMatch(/rewrites/);
    expect(text).toMatch(/Do not set GitHub token environment variables/);
    expect(text).not.toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/gh auth git-credential/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('ssh forbids rewriting remotes', () => {
    const text = formatGitAuthModeDirective('ssh');
    expect(text).toMatch(/mode: SSH/);
    expect(text).toMatch(/Do not rewrite them to HTTPS/);
    expect(text).toMatch(/Keychain/);
    expect(text).not.toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('token mode does not tell agents to read GH_TOKEN', () => {
    const text = formatGitAuthModeDirective('token');
    expect(text).toMatch(/personal access token/);
    expect(text).not.toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/GitHub app/i);
  });
});
