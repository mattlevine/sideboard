import type { ListPrsOptions } from '../git/list-prs.js';
import { listIssues, type ListIssuesResult } from '../integrations/issues.js';
import type { ListIssuesOptions } from '../integrations/issue-list-types.js';
import type { IssueSource } from '../store/app-settings.js';
import type { BranchInfo, PrInfo } from '../types/thread.js';
import { issueProvider } from './issue-provider.js';
import { gitHostForRepo } from './resolve-git-host.js';
import type { GitHostId } from './types.js';

export interface ListWorkSourcesOptions {
  query?: string;
  /** When set, drop branches already merged into the default branch. */
  unmergedOnly?: boolean;
  limit?: number;
  pr?: ListPrsOptions;
  issue?: ListIssuesOptions;
}

export interface WorkSources {
  gitHost: { id: GitHostId; label: string };
  issue: { id: IssueSource; label: string; preferred: IssueSource };
  branches: BranchInfo[];
  pullRequests: PrInfo[];
  issues: ListIssuesResult;
  warnings?: string[];
}

function sourceWarning(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message ? `${label}: ${message}` : `${label} failed.`;
}

/**
 * Branches and pull requests from the git host that matches this repo's origin.
 * Issues come from the active issue provider. The phone picker uses this
 * combined call. Desktop, Home, the CLI, and the MCP list tools call the
 * host methods on their own.
 */
export async function listWorkSources(
  repoPath: string,
  opts?: ListWorkSourcesOptions,
): Promise<WorkSources> {
  const host = await gitHostForRepo(repoPath);
  const query = opts?.query?.trim() ?? '';
  const limit = opts?.limit;
  const warnings: string[] = [];
  const [branches, pullRequests, issues] = await Promise.all([
    host
      .listBranches(repoPath, { unmergedOnly: opts?.unmergedOnly })
      .catch((err: unknown) => {
        warnings.push(sourceWarning('Branches', err));
        return [];
      }),
    host
      .listPullRequests(repoPath, {
        state: 'open',
        ...(limit != null ? { limit } : {}),
        ...(query ? { query } : {}),
        ...opts?.pr,
      })
      .catch((err: unknown) => {
        warnings.push(sourceWarning('Pull requests', err));
        return [];
      }),
    listIssues(repoPath, {
      ...(limit != null ? { limit } : {}),
      ...(query ? { query } : {}),
      ...opts?.issue,
    }).catch((err: unknown) => {
      warnings.push(sourceWarning('Issues', err));
      return {
        source: 'github' as const,
        preferredSource: 'github' as const,
        linearConnected: false,
        abletimeConnected: false,
        issues: [],
      };
    }),
  ]);
  const provider = issueProvider(issues.source);
  const needle = query.toLowerCase();
  const branchRows = needle
    ? branches.filter((branch) => branch.name.toLowerCase().includes(needle))
    : branches;
  return {
    gitHost: { id: host.id, label: host.label },
    issue: {
      id: provider.id,
      label: provider.label,
      preferred: issues.preferredSource,
    },
    branches: branchRows,
    pullRequests,
    issues,
    ...(warnings.length ? { warnings } : {}),
  };
}

export { gitHostForRepo, gitHostForRemote } from './resolve-git-host.js';
export { issueProvider } from './issue-provider.js';
export type { GitHostProvider, IssueProvider, GitHostId } from './types.js';
