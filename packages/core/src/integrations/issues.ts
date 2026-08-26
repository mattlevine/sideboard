import { resolveGithubRepoSlug } from '../git/worktree.js';
import { gh } from '../git/run.js';
import {
  isLinearConnected,
  loadAppSettings,
  resolveEffectiveIssueSource,
  type IssueSource,
} from '../store/app-settings.js';
import type { IssueInfo } from '../types/thread.js';
import { listLinearIssuesDirect } from './linear.js';

export type { IssueSource };

export interface ListIssuesResult {
  source: IssueSource;
  /** Preference before fallback (useful for “Set up Linear” UI). */
  preferredSource: IssueSource;
  linearConnected: boolean;
  issues: IssueInfo[];
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
    'number,title,url,labels',
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
    };
    const number = Number(item.number);
    const identifier = Number.isFinite(number) ? `#${number}` : String(item.title ?? '');
    const labels = (item.labels ?? []).map((l) =>
      typeof l === 'string' ? l : String(l?.name ?? ''),
    ).filter(Boolean);
    return {
      id: Number.isFinite(number) ? `gh-${number}` : identifier,
      identifier,
      title: String(item.title ?? ''),
      url: String(item.url ?? ''),
      labels,
      provider: 'github' as const,
    };
  });
}

/**
 * Unified issue list for Create-from / Link issue / Home / MCP / CLI.
 * Uses Sideboard Account connections — not agent Linear MCP.
 * Linear and GitHub only; AbleTime is typed but has no client yet
 * (`resolveEffectiveIssueSource` falls back to GitHub).
 */
export async function listIssues(repoPath: string): Promise<ListIssuesResult> {
  const settings = loadAppSettings();
  const preferredSource = settings.integrations.issueSource ?? 'github';
  const linearConnected = isLinearConnected(settings);
  const source = resolveEffectiveIssueSource(settings);

  if (source === 'linear') {
    const issues = await listLinearIssuesDirect();
    return { source, preferredSource, linearConnected, issues };
  }

  const issues = await listGitHubIssues(repoPath);
  return { source, preferredSource, linearConnected, issues };
}
