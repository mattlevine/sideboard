import { resolveGithubRepoSlug } from '../git/worktree.js';
import { gh } from '../git/run.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  loadAppSettings,
  resolveEffectiveIssueSource,
  type IssueSource,
} from '../store/app-settings.js';
import type { IssueActivityComment, IssueInfo } from '../types/thread.js';
import {
  getAbleTimeOrientation,
  listAbleTimeTasks,
  searchAbleTimeTasks,
  toAbleTimeIssueInfo,
} from './abletime.js';
import { listGitHubIssueCommentsSince } from './github-issues.js';
import {
  formatGitHubSearchUpdatedSince,
  issueMatchesUpdatedSince,
  parseIssueSince,
  previewIssueCommentBody,
} from './issue-since.js';
import { listLinearCommentsSince, listLinearIssuesFiltered } from './linear.js';

export type { IssueSource };

/** `me`, `unassigned`, `all`, a tracker user id, or a display name / GitHub login. */
export type IssueAssigneeFilter = string;

export interface ListIssuesOptions {
  /** me (Linear default), unassigned, all, or a user id / GitHub login. */
  assignee?: IssueAssigneeFilter;
  /** Case-insensitive search (Linear `searchIssues`, GitHub `--search`, AbleTime search). */
  query?: string;
  limit?: number;
  /**
   * ISO datetime, YYYY-MM-DD, or relative (yesterday, 2d, 3 hours ago).
   * Vendor-side filter for tickets updated since then; also loads new comments.
   */
  updatedSince?: string;
}

export interface ListIssuesResult {
  source: IssueSource;
  /** Preference before fallback (useful for “Set up Linear / AbleTime” UI). */
  preferredSource: IssueSource;
  linearConnected: boolean;
  abletimeConnected: boolean;
  issues: IssueInfo[];
  /** Linear viewer name or GitHub login — used for “assigned to me”. */
  viewer?: { login?: string; name?: string };
  /** Parsed UTC ISO when `updatedSince` was passed. */
  since?: string;
  /** Comments created at/after `since` on the listed tickets. */
  comments?: IssueActivityComment[];
}

function assigneeKey(assignee?: string | null): string {
  return (assignee ?? '').trim().toLowerCase();
}

function takeIssuePage(issues: IssueInfo[], limit?: number): IssueInfo[] {
  if (limit == null) return issues;
  const n = Math.max(1, Math.min(1000, Math.floor(limit)));
  return issues.slice(0, n);
}

export function issueMatchesAssignee(
  issue: Pick<IssueInfo, 'assignee' | 'assignees'>,
  assignee?: string | null,
  viewerName = '',
): boolean {
  const key = assigneeKey(assignee);
  if (!key || key === 'all' || key === '*') return true;
  const names = [...(issue.assignees ?? []), issue.assignee ?? '']
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (key === 'unassigned' || key === 'none' || key === 'null') {
    return names.length === 0;
  }
  if (key === 'me' || key === '@me') {
    const me = viewerName.trim().toLowerCase();
    return Boolean(me && names.includes(me));
  }
  return names.includes(key);
}

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
  const args = [
    'issue',
    'list',
    '--json',
    'number,title,url,labels,assignees,createdAt,updatedAt',
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
  const { stdout, exitCode } = await gh(args, repoPath, { reject: false });
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
    const labels = (item.labels ?? []).map((l) =>
      typeof l === 'string' ? l : String(l?.name ?? ''),
    ).filter(Boolean);
    const assignees = (item.assignees ?? [])
      .map((a) => (typeof a === 'string' ? a : String(a?.login ?? '')))
      .map((login) => login.trim())
      .filter(Boolean);
    const createdAt = item.createdAt?.trim() || undefined;
    const updatedAt = item.updatedAt?.trim() || undefined;
    return {
      id: Number.isFinite(number) ? `gh-${number}` : identifier,
      identifier,
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
      labels,
      provider: 'github' as const,
      assignee: assignees[0],
      assignees,
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  });
}

async function githubViewerLogin(repoPath: string): Promise<string> {
  const { stdout, exitCode } = await gh(['api', 'user', '--jq', '.login'], repoPath, {
    reject: false,
  });
  if (exitCode !== 0) return '';
  return stdout.trim();
}

/**
 * Unified issue list for Create-from / Link issue / Home / MCP / CLI.
 * Uses Sideboard Account connections — Linear GraphQL, AbleTime hosted MCP,
 * or GitHub Issues via `gh`.
 */
export async function listIssues(
  repoPath: string,
  opts?: ListIssuesOptions,
): Promise<ListIssuesResult> {
  const settings = loadAppSettings();
  const preferredSource = settings.integrations.issueSource ?? 'github';
  const linearConnected = isLinearConnected(settings);
  const abletimeConnected = isAbleTimeConnected(settings);
  const source = resolveEffectiveIssueSource(settings);
  const query = opts?.query?.trim() || undefined;
  const assignee = opts?.assignee?.trim() || undefined;
  const since = opts?.updatedSince ? parseIssueSince(opts.updatedSince) : undefined;

  if (source === 'linear') {
    const [listed, comments] = await Promise.all([
      listLinearIssuesFiltered({
        assignee,
        query,
        limit: opts?.limit,
        updatedSince: since,
      }),
      since
        ? listLinearCommentsSince({
            since,
            assignee,
            query,
            limit: opts?.limit,
          })
        : Promise.resolve(undefined),
    ]);
    return {
      source,
      preferredSource,
      linearConnected,
      abletimeConnected,
      issues: listed.issues,
      viewer: {
        login: listed.viewer.name,
        name: listed.viewer.name,
      },
      ...(since ? { since, comments: comments ?? [] } : {}),
    };
  }

  if (source === 'abletime') {
    const [tasks, orientation] = await Promise.all([
      query ? searchAbleTimeTasks(query) : listAbleTimeTasks(),
      getAbleTimeOrientation().catch(() => null),
    ]);
    const viewerName = orientation?.viewer.name ?? orientation?.viewer.id ?? '';
    const mapped = tasks
      .map(toAbleTimeIssueInfo)
      .filter((issue) => issueMatchesAssignee(issue, assignee, viewerName))
      .filter((issue) => !since || issueMatchesUpdatedSince(issue, since));
    const issues = takeIssuePage(mapped, opts?.limit);
    return {
      source,
      preferredSource,
      linearConnected,
      abletimeConnected,
      issues,
      viewer: {
        login: orientation?.viewer.name,
        name: orientation?.viewer.name,
      },
      ...(since
        ? { since, comments: commentsFromAbleTimeIssues(tasks, issues, since) }
        : {}),
    };
  }

  const [issues, login] = await Promise.all([
    listGitHubIssues(repoPath, { assignee, query, limit: opts?.limit, updatedSince: since }),
    githubViewerLogin(repoPath),
  ]);
  const comments = since
    ? await listGitHubIssueCommentsSince({
        since,
        repoPath,
        issueIdentifiers: issues.map((issue) => issue.identifier),
        limit: opts?.limit,
      })
    : undefined;
  return {
    source,
    preferredSource,
    linearConnected,
    abletimeConnected,
    issues,
    viewer: login ? { login } : undefined,
    ...(since ? { since, comments: comments ?? [] } : {}),
  };
}

function commentsFromAbleTimeIssues(
  tasks: Array<{
    identifier: string;
    title: string;
    comments: Array<{ body: string; createdAt?: string; user?: string; url?: string }>;
  }>,
  issues: IssueInfo[],
  sinceIso: string,
): IssueActivityComment[] {
  const keep = new Set(issues.map((issue) => issue.identifier));
  const sinceMs = Date.parse(sinceIso);
  const out: IssueActivityComment[] = [];
  for (const task of tasks) {
    if (!keep.has(task.identifier)) continue;
    for (const comment of task.comments) {
      const at = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
      if (Number.isFinite(at) && Number.isFinite(sinceMs) && at < sinceMs) continue;
      out.push({
        identifier: task.identifier,
        title: task.title,
        ...(comment.user ? { author: comment.user } : {}),
        ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
        body: previewIssueCommentBody(comment.body),
        ...(comment.url ? { url: comment.url } : {}),
      });
    }
  }
  return out;
}
