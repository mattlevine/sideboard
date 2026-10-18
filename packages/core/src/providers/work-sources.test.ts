import { execaSync } from 'execa';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { issueProvider } from './issue-provider.js';
import { remoteHostname, remoteIsGitHub } from './git-remote.js';
import { gitHostForRemote, gitHostForRepo } from './resolve-git-host.js';

describe('work source providers', () => {
  it('keeps branches and pull requests off the issue providers', () => {
    const linear = issueProvider('linear');
    const abletime = issueProvider('abletime');
    const github = issueProvider('github');
    expect(linear.label).toBe('Linear');
    expect(abletime.label).toBe('AbleTime');
    expect(github.label).toBe('GitHub');
    expect(linear).not.toHaveProperty('listBranches');
    expect(linear).not.toHaveProperty('listPullRequests');
    expect(abletime).not.toHaveProperty('listBranches');
    expect(abletime).not.toHaveProperty('listPullRequests');
    expect(typeof github.listIssues).toBe('function');
    expect(typeof github.listIssuePage).toBe('function');
  });
});

describe('git host from origin', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('recognizes GitHub remotes, including SSH aliases', () => {
    expect(remoteHostname('https://github.com/acme/widgets.git')).toBe('github.com');
    expect(remoteHostname('git@github.com:acme/widgets.git')).toBe('github.com');
    expect(remoteHostname('ssh://git@github.com/acme/widgets.git')).toBe('github.com');
    expect(remoteHostname('git@github.com-work:acme/widgets.git')).toBe('github.com-work');
    expect(remoteHostname('git@gitlab.com:acme/app.git')).toBe('gitlab.com');
    expect(remoteIsGitHub('https://github.com/acme/widgets.git')).toBe(true);
    expect(remoteIsGitHub('git@github.com-work:acme/widgets.git')).toBe(true);
    expect(remoteIsGitHub('git@gitlab.com:acme/app.git')).toBe(false);
    expect(remoteIsGitHub('https://gitlab.com/acme/app.git')).toBe(false);
  });

  it('uses GitHub when origin is GitHub or missing', () => {
    expect(gitHostForRemote('').id).toBe('github');
    expect(gitHostForRemote('git@github.com:acme/widgets.git').id).toBe('github');
    expect(gitHostForRemote('git@github.com-work:acme/widgets.git').label).toBe('GitHub');
  });

  it('refuses pull requests and host issues for an unregistered remote', async () => {
    const host = gitHostForRemote('https://gitlab.com/acme/app.git');
    expect(host.id).toBe('unsupported');
    expect(host.label).toBe('gitlab.com');
    await expect(host.listPullRequests('/tmp/repo')).rejects.toThrow(/gitlab\.com/);
    await expect(host.listIssues('/tmp/repo')).rejects.toThrow(/No git host is registered/);
  });

  it('reads origin from the checkout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-git-host-'));
    dirs.push(dir);
    execaSync('git', ['init'], { cwd: dir });
    execaSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:acme/app.git'], { cwd: dir });
    const host = await gitHostForRepo(dir);
    expect(host.id).toBe('unsupported');
    expect(host.label).toBe('gitlab.com');
  });
});
