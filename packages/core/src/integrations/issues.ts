import { resolveGithubRepoSlug } from '../git/worktree.js';
import { gh } from '../git/run.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  loadAppSettings,
  resolveEffectiveIssueSource,
  type IssueSource,
} from '../store/app-settings.js';
import type { IssueInfo } from '../types/thread.js';
import {
  getAbleTimeOrientation,
  listAbleTimeAssignedIssues,
  searchAbleTimeTasks,
  toAbleTimeIssueInfo,
} from './abletime.js';
import { listLinearIssuesFiltered } from './linear.js';

export type { IssueSource };

/** `me`, `unassigned`, `all`, a tracker user id, or a display name / GitHub login. */
export type IssueAssigneeFilter = string;

export interface ListIssuesOptions {
  /** me (Linear default), unassigned, all, or a user id / GitHub login. */
  assignee?: IssueAssigneeFilter;
  /** Case-insensitive search (Linear `searchIssues`, GitHub `--search`, AbleTime search). */
  query?: string;
  limit?: number;
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
  opts?: { limit?: number; assignee?: string; query?: string },
): Promise<IssueInfo[]> {
  const limit = Math.max(1, Math.min(1000, opts?.limit ?? 200));
  const slug = await resolveGithubRepoSlug(repoPath);
  const args = [
    'issue',
    'list',
    '--json',
    'number,title,url,labels,assignees',
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
    return {
      id: Number.isFinite(number) ? `gh-${number}` : identifier,
      identifier,
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
      labels,
      provider: 'github' as const,
      assignee: assignees[0],
      assignees,
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

  if (source === 'linear') {
    const listed = await listLinearIssuesFiltered({
      assignee,
      query,
      limit: opts?.limit,
    });
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
    };
  }

  if (source === 'abletime') {
    if (query) {
      const [searched, orientation] = await Promise.all([
        searchAbleTimeTasks(query),
        getAbleTimeOrientation().catch(() => null),
      ]);
      const viewerName = orientation?.viewer.name ?? orientation?.viewer.id ?? '';
      const issues = takeIssuePage(
        searched
          .map(toAbleTimeIssueInfo)
          .filter((issue) => issueMatchesAssignee(issue, assignee, viewerName)),
        opts?.limit,
      );
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
      };
    }
    const listed = await listAbleTimeAssignedIssues();
    const viewerName = listed.viewer.name ?? listed.viewer.id ?? '';
    const issues = takeIssuePage(
      listed.issues.filter((issue) => issueMatchesAssignee(issue, assignee, viewerName)),
      opts?.limit,
    );
    return {
      source,
      preferredSource,
      linearConnected,
      abletimeConnected,
      issues,
      viewer: {
        login: listed.viewer.name,
        name: listed.viewer.name,
      },
    };
  }

  const [issues, login] = await Promise.all([
    listGitHubIssues(repoPath, { assignee, query, limit: opts?.limit }),
    githubViewerLogin(repoPath),
  ]);
  return {
    source,
    preferredSource,
    linearConnected,
    abletimeConnected,
    issues,
    viewer: login ? { login } : undefined,
  };
}
