import type { ListPrsOptions } from '../git/list-prs.js';
import { listBranches, listPrs } from '../git/worktree.js';
import { remoteIsGitHub } from './git-remote.js';
import { listGitHubIssues } from './github-issue-list.js';
import type { GitHostProvider } from './types.js';

/**
 * GitHub host. Branches are local refs (including `origin/`). Issues and
 * pull requests come from `gh` on that remote. Selected when origin is
 * github.com, a github.com subdomain, or an SSH alias such as `github.com-work`.
 */
export const githubGitHost: GitHostProvider = {
  id: 'github',
  label: 'GitHub',
  matches(remoteUrl) {
    return remoteIsGitHub(remoteUrl);
  },
  listBranches(repoPath, opts) {
    return listBranches(repoPath, opts);
  },
  listIssues(repoPath, opts) {
    return listGitHubIssues(repoPath, opts);
  },
  listPullRequests(repoPath, opts?: ListPrsOptions) {
    return listPrs(repoPath, opts);
  },
};
