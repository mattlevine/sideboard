import { git } from '../git/run.js';
import { listBranches } from '../git/worktree.js';
import { remoteHostname } from './git-remote.js';
import { githubGitHost } from './github-host.js';
import type { GitHostProvider } from './types.js';

/** Origin matches no registered host. Branches still come from local git. */
export class UnsupportedGitHostError extends Error {
  readonly hostname: string;

  constructor(remoteUrl: string) {
    const hostname = remoteHostname(remoteUrl) || remoteUrl.trim();
    super(
      `No git host is registered for ${hostname}. Local branches still list. Pull requests and host issues need a host that matches this remote.`,
    );
    this.name = 'UnsupportedGitHostError';
    this.hostname = hostname;
  }
}

function unsupportedGitHost(remoteUrl: string): GitHostProvider {
  const hostname = remoteHostname(remoteUrl) || remoteUrl.trim();
  const refuse = () => Promise.reject(new UnsupportedGitHostError(remoteUrl));
  return {
    id: 'unsupported',
    label: hostname,
    matches() {
      return false;
    },
    listBranches(repoPath, opts) {
      return listBranches(repoPath, opts);
    },
    listIssues: refuse,
    listPullRequests: refuse,
  };
}

/**
 * Registered hosts, first match wins. Append a host here when it lands:
 * implement {@link GitHostProvider}, including `matches` for its remotes.
 */
const GIT_HOST_PROVIDERS: readonly GitHostProvider[] = [githubGitHost];

/**
 * Host for a remote URL. A missing URL stays on GitHub (`gh` can still
 * resolve the repo). Any other unmatched URL is unsupported — it does not
 * call `gh`.
 */
export function gitHostForRemote(remoteUrl: string): GitHostProvider {
  const url = remoteUrl.trim();
  if (!url) return githubGitHost;
  return GIT_HOST_PROVIDERS.find((host) => host.matches(url)) ?? unsupportedGitHost(url);
}

export async function readOriginUrl(repoPath: string): Promise<string> {
  const result = await git(['remote', 'get-url', 'origin'], repoPath, {
    reject: false,
    timeoutMs: 5_000,
  });
  return result.exitCode === 0 ? result.stdout.trim() : '';
}

/** Host that owns this checkout's `origin`. */
export async function gitHostForRepo(repoPath: string): Promise<GitHostProvider> {
  return gitHostForRemote(await readOriginUrl(repoPath));
}

/**
 * GitHub issue tools. A registered non-GitHub host must not be queried as
 * GitHub; it gets its own issue provider. An unmatched remote throws
 * {@link UnsupportedGitHostError}.
 */
export async function githubHostForRepo(repoPath: string): Promise<GitHostProvider> {
  const host = await gitHostForRepo(repoPath);
  if (host.id === 'github') return host;
  await host.listIssues(repoPath);
  throw new Error(`Issue source is GitHub, but this repo's git host is ${host.label}.`);
}
