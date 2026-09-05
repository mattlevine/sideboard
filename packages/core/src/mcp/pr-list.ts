import type { PrInfo } from '../types/thread.js';
import { applyIssueListWindow, clampMcpIssueLimit } from './issue-list.js';

export { applyIssueListWindow, clampMcpIssueLimit };

export function compactPrRow(pr: PrInfo): {
  number: number;
  title: string;
  head?: string;
  author?: string;
  state?: string;
  draft?: boolean;
  labels?: string[];
  reviewers?: string[];
  teams?: string[];
  reviewDecision?: string;
  tickets?: string[];
} {
  return {
    number: pr.number,
    title: pr.title,
    ...(pr.headRefName ? { head: pr.headRefName } : {}),
    ...(pr.author?.login ? { author: pr.author.login } : {}),
    ...(pr.state ? { state: pr.state } : {}),
    ...(pr.isDraft ? { draft: true } : {}),
    ...(pr.labels?.length ? { labels: pr.labels } : {}),
    ...(pr.reviewers?.length ? { reviewers: pr.reviewers } : {}),
    ...(pr.teams?.length ? { teams: pr.teams } : {}),
    ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
    ...(pr.tickets?.length ? { tickets: pr.tickets } : {}),
  };
}

export function formatMcpPrList(input: {
  viewer?: string;
  queue?: string;
  state: string;
  labels?: string[];
  reviewer?: string;
  query?: string;
  limit: number;
  prs: PrInfo[];
  truncated: boolean;
}): {
  viewer?: string;
  queue?: string;
  state: string;
  labels?: string[];
  reviewer?: string;
  query?: string;
  limit: number;
  returned: number;
  truncated: boolean;
  hint?: string;
  prs: ReturnType<typeof compactPrRow>[];
} {
  return {
    ...(input.viewer ? { viewer: input.viewer } : {}),
    ...(input.queue ? { queue: input.queue } : {}),
    state: input.state,
    ...(input.labels?.length ? { labels: input.labels } : {}),
    ...(input.reviewer ? { reviewer: input.reviewer } : {}),
    ...(input.query ? { query: input.query } : {}),
    limit: input.limit,
    returned: input.prs.length,
    truncated: input.truncated,
    ...(input.truncated
      ? {
          hint: 'More PRs match. Pass a higher limit (max 250) or tighten label / reviewer / query.',
        }
      : {}),
    prs: input.prs.map(compactPrRow),
  };
}
