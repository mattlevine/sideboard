import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gitCredentialStoreContents,
  githubAgentAuthReady,
  githubCredentialStorePath,
  githubGhConfigDir,
  materializeGithubAgentAuth,
} from './github-agent-auth.js';

describe('github-agent-auth', () => {
  let dir: string;
  const prev = process.env.SIDEBOARD_GIT_AUTH_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sideboard-git-auth-'));
    process.env.SIDEBOARD_GIT_AUTH_DIR = dir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.SIDEBOARD_GIT_AUTH_DIR;
    else process.env.SIDEBOARD_GIT_AUTH_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it('encodes the token in the credential-store URL', () => {
    expect(gitCredentialStoreContents('ab:c@d')).toBe(
      `https://x-access-token:${encodeURIComponent('ab:c@d')}@github.com\n`,
    );
  });

  it('writes 0600 credential + gh hosts files without echoing the token in env paths', () => {
    materializeGithubAgentAuth('gho_secret');
    expect(githubAgentAuthReady()).toBe(true);
    expect(statSync(githubCredentialStorePath()).mode & 0o777).toBe(0o600);
    const hosts = readFileSync(join(githubGhConfigDir(), 'hosts.yml'), 'utf8');
    expect(hosts).toContain('oauth_token: gho_secret');
    expect(hosts).toContain('git_protocol: https');
  });
});
