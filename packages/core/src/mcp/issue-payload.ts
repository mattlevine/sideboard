import { z } from 'zod';
import { toAbleTimeIssueInfo, type AbleTimeTask } from '../integrations/abletime.js';
import type { GitHubIssue } from '../integrations/github-issues.js';
import type { LinearIssue } from '../integrations/linear.js';
import { crushMarkdown, crushTextItems } from './smart-crush.js';

export const MCP_ISSUE_INCLUDE_VALUES = ['default', 'full'] as const;
export type McpIssueInclude = (typeof MCP_ISSUE_INCLUDE_VALUES)[number];

export const mcpIssueIncludeSchema = z
  .enum(MCP_ISSUE_INCLUDE_VALUES)
  .optional()
  .describe(
    'default applies SmartCrusher-style crush (dedup + budget; small unique tickets pass through). full returns the uncompressed vendor payload. Re-call with include=full if crush.truncated.',
  );

export const MCP_ISSUE_CRUSH_HINT =
  'Pass include=full to re-fetch the uncompressed ticket from the vendor.';

export interface IssueCrushMeta {
  truncated: true;
  hint: typeof MCP_ISSUE_CRUSH_HINT;
  comments?: { kept: number; dropped: number; reason: string };
  body?: { originalChars: number };
}

function emptyMeta(): IssueCrushMeta {
  return { truncated: true, hint: MCP_ISSUE_CRUSH_HINT };
}

function withComments<T extends { body: string }>(
  comments: T[],
  meta: IssueCrushMeta,
): { comments: T[]; meta: IssueCrushMeta } {
  const crushed = crushTextItems(comments, (c) => c.body);
  if (crushed.truncated) {
    meta.comments = {
      kept: crushed.kept,
      dropped: crushed.dropped,
      reason: crushed.reason,
    };
  }
  return { comments: crushed.items, meta };
}

function withBody(
  text: string | undefined,
  meta: IssueCrushMeta,
): { value: string | undefined; meta: IssueCrushMeta } {
  const crushed = crushMarkdown(text);
  if (crushed.truncated) {
    meta.body = { originalChars: crushed.originalChars };
    return { value: crushed.text, meta };
  }
  return { value: text, meta };
}

function attachCrush<T extends object>(
  payload: T,
  meta: IssueCrushMeta,
): T | (T & { crush: IssueCrushMeta }) {
  if (!meta.comments && !meta.body) return payload;
  return { ...payload, crush: meta };
}

/** Linear get: crush description + comments; drop team.states (use linear_list_teams). */
export function formatLinearIssuePayload(
  issue: LinearIssue,
  include?: McpIssueInclude,
): LinearIssue | (Omit<LinearIssue, 'team'> & {
  team?: { id: string; key: string; name: string };
  crush?: IssueCrushMeta;
}) {
  if (include === 'full') return issue;
  const meta = emptyMeta();
  const comments = withComments(issue.comments, meta);
  const description = withBody(issue.description, comments.meta);
  const { team, ...rest } = issue;
  const next = {
    ...rest,
    ...(team ? { team: { id: team.id, key: team.key, name: team.name } } : {}),
    description: description.value,
    comments: comments.comments,
  };
  return attachCrush(next, description.meta);
}

/** GitHub get: crush body + comments. */
export function formatGitHubIssuePayload(
  issue: GitHubIssue,
  include?: McpIssueInclude,
): GitHubIssue | (GitHubIssue & { crush: IssueCrushMeta }) {
  if (include === 'full') return issue;
  const meta = emptyMeta();
  const comments = withComments(issue.comments, meta);
  const body = withBody(issue.body, comments.meta);
  const next: GitHubIssue = {
    ...issue,
    body: body.value,
    comments: comments.comments,
  };
  return attachCrush(next, body.meta);
}

export function formatAbleTimeTaskPayload(task: AbleTimeTask, include?: McpIssueInclude) {
  const base = {
    ...toAbleTimeIssueInfo(task),
    description: task.description,
    state: task.state,
    comments: task.comments,
  };
  if (include === 'full') return base;
  const meta = emptyMeta();
  const comments = withComments(task.comments, meta);
  const description = withBody(task.description, comments.meta);
  return attachCrush(
    {
      ...base,
      description: description.value,
      comments: comments.comments,
    },
    description.meta,
  );
}
