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
import { listAbleTimeAssignedIssues } from './abletime.js';
import { listLinearAssignedIssues } from './linear.js';

export type { IssueSource };

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

/**
 * List GitHub Issues for the repo via `gh` (machine-global auth).
 * Scoped to the workspace's connected GitHub remote via `--repo`.
 */
export async function listGitHubIssues(
  repoPath: string,
  opts?: { limit?: number },
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
export async function listIssues(repoPath: string): Promise<ListIssuesResult> {
  const settings = loadAppSettings();
  const preferredSource = settings.integrations.issueSource ?? 'github';
  const linearConnected = isLinearConnected(settings);
  const abletimeConnected = isAbleTimeConnected(settings);
  const source = resolveEffectiveIssueSource(settings);

  if (source === 'linear') {
    const listed = await listLinearAssignedIssues();
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
    const listed = await listAbleTimeAssignedIssues();
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

  const [issues, login] = await Promise.all([
    listGitHubIssues(repoPath),
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
