import type { ListPrsOptions } from '../git/list-prs.js';
import type { ListIssuesOptions } from '../integrations/issue-list-types.js';
import type { IssueSource } from '../store/app-settings.js';
import type { BranchInfo, IssueActivityComment, IssueInfo, PrInfo } from '../types/thread.js';

/**
 * Registered git hosts. Add a host by implementing {@link GitHostProvider}
 * and appending it in `resolve-git-host.ts`. `unsupported` is the fallback
 * when origin matches none of them.
 */
export const GIT_HOSTS = ['github'] as const;
export type RegisteredGitHostId = (typeof GIT_HOSTS)[number];
export type GitHostId = RegisteredGitHostId | 'unsupported';

/**
 * Branches, this host's own issues, and pull requests.
 * Callers use `gitHostForRepo` so a new host is selected from origin
 * without editing the pickers, tools, or skills.
 */
export interface GitHostProvider {
  readonly id: GitHostId;
  readonly label: string;
  /** True when this host owns the remote URL. */
  matches(remoteUrl: string): boolean;
  listBranches(
    repoPath: string,
    opts?: { unmergedOnly?: boolean },
  ): Promise<BranchInfo[]>;
  /** This host's own issues. Linear and AbleTime are issue providers, not hosts. */
  listIssues(repoPath: string, opts?: ListIssuesOptions): Promise<IssueInfo[]>;
  /**
   * Pull requests on this remote. `queue`, `state`, `labels`, and `reviewer`
   * are the product filters. GitHub maps `queue=review` onto its ready-for-review
   * label. Another host maps the same options onto its own review model.
   */
  listPullRequests(repoPath: string, opts?: ListPrsOptions): Promise<PrInfo[]>;
}

export interface IssuePage {
  issues: IssueInfo[];
  viewer?: { login?: string; name?: string };
  since?: string;
  comments?: IssueActivityComment[];
}

/** Tickets for Settings → Issues. Branches and pull requests stay on the git host. */
export interface IssueProvider {
  readonly id: IssueSource;
  readonly label: string;
  listIssues(repoPath: string, opts?: ListIssuesOptions): Promise<IssueInfo[]>;
  /** Issues for the active tracker, including viewer and comment activity. */
  listIssuePage(repoPath: string, opts?: ListIssuesOptions): Promise<IssuePage>;
}
