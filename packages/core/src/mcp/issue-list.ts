import { z } from 'zod';
import { issueActivityKind } from '../integrations/issue-since.js';
import type { IssueActivityComment, IssueInfo } from '../types/thread.js';

/** Cheap first page for MCP discovery. Raise `limit` or tighten `query` when truncated. */
export const MCP_ISSUE_LIST_DEFAULT_LIMIT = 40;
export const MCP_ISSUE_LIST_MAX_LIMIT = 250;

export function clampMcpIssueLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return MCP_ISSUE_LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(MCP_ISSUE_LIST_MAX_LIMIT, Math.floor(limit)));
}

export function applyIssueListWindow<T>(
  items: T[],
  limit: number,
): { items: T[]; truncated: boolean } {
  const truncated = items.length > limit;
  return {
    items: truncated ? items.slice(0, limit) : items,
    truncated,
  };
}

export const MCP_ISSUE_UPDATED_SINCE_DESCRIPTION =
  'ISO datetime, YYYY-MM-DD, or relative (yesterday, 2d, 3 hours ago). Tickets updated since then plus new comments. Use for “any updates since yesterday?”';

export const mcpIssueUpdatedSinceSchema = z
  .string()
  .min(1)
  .optional()
  .describe(MCP_ISSUE_UPDATED_SINCE_DESCRIPTION);

export function compactIssueRow(
  issue: IssueInfo,
  opts?: { since?: string },
): {
  identifier: string;
  title: string;
  assignee?: string;
  labels?: string[];
  team?: string;
  cycle?: string;
  createdAt?: string;
  updatedAt?: string;
  kind?: 'created' | 'updated';
} {
  return {
    identifier: issue.identifier,
    title: issue.title,
    ...(issue.assignee ? { assignee: issue.assignee } : {}),
    ...(issue.labels.length > 0 ? { labels: issue.labels } : {}),
    ...(issue.teamKey ? { team: issue.teamKey } : {}),
    ...(issue.cycle?.name ? { cycle: issue.cycle.name } : {}),
    ...(issue.createdAt ? { createdAt: issue.createdAt } : {}),
    ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
    ...(opts?.since ? { kind: issueActivityKind(issue, opts.since) } : {}),
  };
}

export function formatMcpIssueList(input: {
  source?: string;
  viewer?: string;
  limit: number;
  issues: IssueInfo[];
  truncated: boolean;
  since?: string;
  comments?: IssueActivityComment[];
  commentsTruncated?: boolean;
}): {
  source?: string;
  viewer?: string;
  limit: number;
  returned: number;
  truncated: boolean;
  hint?: string;
  since?: string;
  issues: ReturnType<typeof compactIssueRow>[];
  comments?: IssueActivityComment[];
} {
  const truncated = input.truncated || Boolean(input.commentsTruncated);
  const comments = input.comments ?? [];
  return {
    ...(input.source ? { source: input.source } : {}),
    ...(input.viewer ? { viewer: input.viewer } : {}),
    limit: input.limit,
    returned: input.issues.length,
    truncated,
    ...(input.since ? { since: input.since } : {}),
    ...(truncated
      ? {
          hint: input.since
            ? 'More issues or comments match. Pass a higher limit (max 250) or a tighter query.'
            : 'More issues match. Pass a higher limit (max 250) or a tighter query.',
        }
      : {}),
    issues: input.issues.map((issue) => compactIssueRow(issue, { since: input.since })),
    ...(input.since || comments.length > 0 ? { comments } : {}),
  };
}

export function formatListedIssuesForMcp(
  result: {
    source?: string;
    viewer?: { name?: string; login?: string };
    issues: IssueInfo[];
    since?: string;
    comments?: IssueActivityComment[];
  },
  page: number,
): ReturnType<typeof formatMcpIssueList> {
  const windowed = applyIssueListWindow(result.issues, page);
  const comments = result.comments ?? [];
  const commentWindow = applyIssueListWindow(comments, page);
  return formatMcpIssueList({
    source: result.source,
    viewer: result.viewer?.name || result.viewer?.login,
    limit: page,
    issues: windowed.items,
    truncated: windowed.truncated,
    since: result.since,
    comments: commentWindow.items,
    commentsTruncated: commentWindow.truncated,
  });
}

/** Compact JSON for MCP tool results (no pretty-print whitespace). Chat inspector re-indents. */
export function mcpJson(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}
