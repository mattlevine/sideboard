import { describe, expect, it } from 'vitest';
import {
  appendIndexedGitConfig,
  applyGithubGitAuthEnv,
  formatGitAuthModeDirective,
  githubAgentGitEnv,
} from './git-auth-mode.js';

describe('appendIndexedGitConfig', () => {
  it('starts at 0 when no inherited GIT_CONFIG_* is present', () => {
    expect(githubAgentGitEnv()).toEqual({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_0: 'git@github.com:',
      GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_1: 'ssh://git@github.com/',
      GIT_CONFIG_KEY_2: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_2: '!gh auth git-credential',
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
  it('auto and ssh do not rewrite remotes', () => {
    expect(applyGithubGitAuthEnv({}, { mode: 'auto' })).toEqual({});
    expect(applyGithubGitAuthEnv({}, { mode: 'ssh' })).toEqual({});
  });

  it('gh rewrites SSH remotes to HTTPS via gh credentials', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'gh' });
    expect(env.GIT_CONFIG_COUNT).toBe('3');
    expect(env.GIT_CONFIG_VALUE_2).toBe('!gh auth git-credential');
    expect(env.GH_TOKEN).toBeUndefined();
  });

  it('token rewrites remotes and sets GH_TOKEN when missing', () => {
    const env = applyGithubGitAuthEnv({}, { mode: 'token', token: 'ghp_secret' });
    expect(env.GH_TOKEN).toBe('ghp_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('3');
  });

  it('does not overwrite an existing GH_TOKEN', () => {
    const env = applyGithubGitAuthEnv(
      { GH_TOKEN: 'from-shell' },
      { mode: 'token', token: 'ghp_secret' },
    );
    expect(env.GH_TOKEN).toBeUndefined();
  });
});

describe('formatGitAuthModeDirective', () => {
  it('auto tells agents to keep remotes and fall back to gh HTTPS', () => {
    const text = formatGitAuthModeDirective('auto');
    expect(text).toMatch(/mode: auto/);
    expect(text).toMatch(/Permission denied \(publickey\)/);
    expect(text).toMatch(/AUTHORIZATION: bearer/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('gh tells agents remotes are rewritten', () => {
    const text = formatGitAuthModeDirective('gh');
    expect(text).toMatch(/mode: gh CLI/);
    expect(text).toMatch(/rewrites/);
    expect(text).toMatch(/gh auth git-credential/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('ssh forbids rewriting remotes', () => {
    const text = formatGitAuthModeDirective('ssh');
    expect(text).toMatch(/mode: SSH/);
    expect(text).toMatch(/Do not rewrite them to HTTPS/);
    expect(text).not.toMatch(/GitHub app/i);
  });

  it('token mentions GH_TOKEN and never a GitHub app', () => {
    const text = formatGitAuthModeDirective('token');
    expect(text).toMatch(/personal access token/);
    expect(text).toMatch(/GH_TOKEN/);
    expect(text).not.toMatch(/GitHub app/i);
  });
});
