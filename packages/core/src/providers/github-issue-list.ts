import { resolveGithubRepoSlug } from '../git/worktree.js';
import { gh } from '../git/run.js';
import type { IssueInfo } from '../types/thread.js';
import { githubProjectsOnIssue } from '../integrations/github-issues.js';
import { formatGitHubSearchUpdatedSince } from '../integrations/issue-since.js';

/**
 * List GitHub Issues for the repo via `gh` (machine-global auth).
 * Scoped to the workspace's connected GitHub remote via `--repo`.
 */
export async function listGitHubIssues(
  repoPath: string,
  opts?: { limit?: number; assignee?: string; query?: string; updatedSince?: string },
): Promise<IssueInfo[]> {
  const limit = Math.max(1, Math.min(1000, opts?.limit ?? 200));
  const slug = await resolveGithubRepoSlug(repoPath);
  const plainFields = 'number,title,url,labels,assignees,createdAt,updatedAt';
  const buildArgs = (jsonFields: string) => {
    const args = [
      'issue',
      'list',
      '--json',
      jsonFields,
      '--limit',
      String(limit),
      '--state',
      'open',
    ];
    const query = opts?.query?.trim() ?? '';
    const assignee = opts?.assignee?.trim() ?? '';
    const key = assignee.toLowerCase();
    const searchParts: string[] = [];
    if (query) searchParts.push(query);
    if (opts?.updatedSince) {
      searchParts.push(`updated:>=${formatGitHubSearchUpdatedSince(opts.updatedSince)}`);
    }
    if (key === 'unassigned' || key === 'none' || key === 'null') {
      searchParts.push('no:assignee');
    } else if (key && key !== 'all' && key !== '*') {
      args.push('--assignee', key === 'me' || key === '@me' ? '@me' : assignee);
    }
    if (searchParts.length) args.push('--search', searchParts.join(' '));
    if (slug) args.push('--repo', slug);
    return args;
  };
  let { stdout, exitCode } = await gh(buildArgs(`${plainFields},projectItems`), repoPath, {
    reject: false,
  });
  // Missing scope, unknown fields, GraphQL complexity, timeouts, and 502s on
  // projectItems used to still list issues. Retry without that field so a
  // project-read failure does not look like an empty inbox.
  if (exitCode !== 0) {
    ({ stdout, exitCode } = await gh(buildArgs(plainFields), repoPath, { reject: false }));
  }
  if (exitCode !== 0 || !stdout.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map((raw) => {
    const item = raw as {
      number?: number;
      title?: string;
      url?: string;
      createdAt?: string;
      updatedAt?: string;
      labels?: Array<{ name?: string } | string>;
      assignees?: Array<{ login?: string } | string>;
    };
    const number = Number(item.number);
    const identifier = Number.isFinite(number) ? `#${number}` : String(item.title ?? '');
    const labels = (item.labels ?? [])
      .map((l) => (typeof l === 'string' ? l : String(l?.name ?? '')))
      .filter(Boolean);
    const assignees = (item.assignees ?? [])
      .map((a) => (typeof a === 'string' ? a : String(a?.login ?? '')))
      .map((login) => login.trim())
      .filter(Boolean);
    const createdAt = item.createdAt?.trim() || undefined;
    const updatedAt = item.updatedAt?.trim() || undefined;
    const record = raw as Record<string, unknown>;
    const projects = githubProjectsOnIssue(record);
    const readProjects =
      'projectItems' in record || 'projects' in record || 'projectItemsV2' in record;
    return {
      id: Number.isFinite(number) ? `gh-${number}` : identifier,
      identifier,
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
      labels,
      provider: 'github' as const,
      assignee: assignees[0],
      assignees,
      ...(readProjects ? { projects } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  });
}

export async function githubViewerLogin(repoPath: string): Promise<string> {
  const { stdout, exitCode } = await gh(['api', 'user', '--jq', '.login'], repoPath, {
    reject: false,
  });
  if (exitCode !== 0) return '';
  return stdout.trim();
}
