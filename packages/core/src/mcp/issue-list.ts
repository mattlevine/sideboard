import type { IssueInfo } from '../types/thread.js';

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

export function compactIssueRow(issue: IssueInfo): {
  identifier: string;
  title: string;
  assignee?: string;
  labels?: string[];
  team?: string;
  cycle?: string;
} {
  return {
    identifier: issue.identifier,
    title: issue.title,
    ...(issue.assignee ? { assignee: issue.assignee } : {}),
    ...(issue.labels.length > 0 ? { labels: issue.labels } : {}),
    ...(issue.teamKey ? { team: issue.teamKey } : {}),
    ...(issue.cycle?.name ? { cycle: issue.cycle.name } : {}),
  };
}

export function formatMcpIssueList(input: {
  source?: string;
  viewer?: string;
  limit: number;
  issues: IssueInfo[];
  truncated: boolean;
}): {
  source?: string;
  viewer?: string;
  limit: number;
  returned: number;
  truncated: boolean;
  hint?: string;
  issues: ReturnType<typeof compactIssueRow>[];
} {
  return {
    ...(input.source ? { source: input.source } : {}),
    ...(input.viewer ? { viewer: input.viewer } : {}),
    limit: input.limit,
    returned: input.issues.length,
    truncated: input.truncated,
    ...(input.truncated
      ? { hint: 'More issues match. Pass a higher limit (max 250) or a tighter query.' }
      : {}),
    issues: input.issues.map(compactIssueRow),
  };
}

/** Compact JSON for MCP tool results (no pretty-print whitespace). */
export function mcpJson(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}
