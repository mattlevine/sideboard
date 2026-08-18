import { describe, expect, it } from 'vitest';
import {
  appendIndexedGitConfig,
  applyGithubGitAuthEnv,
  codexUnattendedGitConfigArgs,
  formatGitAuthModeDirective,
  githubAgentGitEnv,
  nonInteractiveGitProcessEnv,
} from './git-auth-mode.js';

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
    expect(githubAgentGitEnv()).toEqual({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_0: 'git@github.com:',
      GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_1: 'ssh://git@github.com/',
      GIT_CONFIG_KEY_2: 'credential.helper',
      GIT_CONFIG_VALUE_2: '',
    });
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
  it('ssh stays batch-mode and does not rewrite remotes', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'ssh' });
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_SSH_COMMAND).toMatch(/BatchMode=yes/);
  });

  it('auto rewrites SSH remotes to HTTPS and disables osxkeychain', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'auto' });
    expect(env.GIT_CONFIG_COUNT).toBe('3');
    expect(env.GIT_CONFIG_VALUE_2).toBe('');
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('gh injects GH_TOKEN and a bearer header so git never uses the Keychain', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'gh', token: 'gho_secret' });
    expect(env.GH_TOKEN).toBe('gho_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('4');
    expect(env.GIT_CONFIG_KEY_3).toBe('http.https://github.com/.extraHeader');
    expect(env.GIT_CONFIG_VALUE_3).toBe('AUTHORIZATION: bearer gho_secret');
  });

  it('token rewrites remotes and sets GH_TOKEN when missing', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'token', token: 'ghp_secret' });
    expect(env.GH_TOKEN).toBe('ghp_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('4');
  });

  it('does not overwrite an existing GH_TOKEN', () => {
    const env = applyGithubGitAuthEnv(
      { GH_TOKEN: 'from-shell' },
      { mode: 'token', token: 'ghp_secret' },
    );
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_3).toBe('AUTHORIZATION: bearer from-shell');
  });
});

describe('codexUnattendedGitConfigArgs', () => {
  it('keeps GH_TOKEN / GIT_CONFIG in the sandbox and enables network for workspace-write', () => {
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
  it('auto tells agents HTTPS is in-process and Keychain must not appear', () => {
    const text = formatGitAuthModeDirective('auto');
    expect(text).toMatch(/mode: auto/);
    expect(text).toMatch(/Keychain/);
    expect(text).toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('gh tells agents remotes are rewritten without Keychain', () => {
    const text = formatGitAuthModeDirective('gh');
    expect(text).toMatch(/mode: gh CLI/);
    expect(text).toMatch(/rewrites/);
    expect(text).toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/gh auth git-credential/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('ssh forbids rewriting remotes', () => {
    const text = formatGitAuthModeDirective('ssh');
    expect(text).toMatch(/mode: SSH/);
    expect(text).toMatch(/Do not rewrite them to HTTPS/);
    expect(text).toMatch(/Keychain/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('token mentions GH_TOKEN and never a GitHub app', () => {
    const text = formatGitAuthModeDirective('token');
    expect(text).toMatch(/personal access token/);
    expect(text).toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/GitHub app/i);
  });
});
