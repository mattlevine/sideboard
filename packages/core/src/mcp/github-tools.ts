import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveRepoRoot } from '../git/worktree.js';
import {
  commentGitHubIssue,
  createGitHubIssue,
  getGitHubIssue,
  listGitHubIssueCommentsSince,
  updateGitHubIssue,
} from '../integrations/github-issues.js';
import { listGitHubIssues } from '../integrations/issues.js';
import { parseIssueSince } from '../integrations/issue-since.js';
import {
  clampMcpIssueLimit,
  formatListedIssuesForMcp,
  mcpIssueUpdatedSinceSchema,
  mcpJson,
} from './issue-list.js';
import { formatGitHubIssuePayload, mcpIssueIncludeSchema } from './issue-payload.js';

function text(payload: unknown, isError = false) {
  return mcpJson(payload, isError);
}

function fail(err: unknown) {
  return text(
    { error: err instanceof Error ? err.message : String(err) },
    true,
  );
}

const repoPathSchema = z
  .string()
  .optional()
  .describe('Workspace / worktree path. Omit on a worktree turn (uses cwd).');

export const GITHUB_ISSUE_MCP_TOOL_NAMES = [
  'github_search_issues',
  'github_get_issue',
  'github_comment',
  'github_update_issue',
  'github_create_issue',
] as const;

/**
 * GitHub Issues via Account `gh` (Settings → Git). Not a vendor GitHub MCP.
 */
export function registerGithubIssueTools(server: McpServer): void {
  server.tool(
    'github_search_issues',
    'Search or list open GitHub issues in this repo via Account gh. Default 40; pass query and/or limit (max 250) when truncated. assignee: me, unassigned, all, or a login. Pass updatedSince for new/updated tickets and new comments (e.g. “any updates since yesterday?”).',
    {
      query: z
        .string()
        .optional()
        .describe('Search text (title, body, identifiers). Omit to list by assignee only.'),
      assignee: z
        .string()
        .optional()
        .describe('me, unassigned, all, or a GitHub login. Default: all when query is set, otherwise me.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(250)
        .optional()
        .describe('Page size (default 40, max 250). Raise when truncated is true.'),
      updatedSince: mcpIssueUpdatedSinceSchema,
      repoPath: repoPathSchema,
    },
    async ({ query, assignee, limit, updatedSince, repoPath }) => {
      try {
        const cwd = await resolveRepoRoot((repoPath ?? '').trim() || process.cwd());
        const page = clampMcpIssueLimit(limit);
        const since = updatedSince ? parseIssueSince(updatedSince) : undefined;
        const issues = await listGitHubIssues(cwd, {
          query,
          assignee: assignee || (query ? 'all' : 'me'),
          limit: page + 1,
          updatedSince: since,
        });
        const comments = since
          ? await listGitHubIssueCommentsSince({
              since,
              repoPath: cwd,
              issueIdentifiers: issues.map((issue) => issue.identifier),
              limit: page + 1,
            })
          : undefined;
        return mcpJson(
          formatListedIssuesForMcp(
            {
              source: 'github',
              issues,
              since,
              comments,
            },
            page,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'github_get_issue',
    'Get a GitHub issue (#123 or URL): body, comments, state. Re-fetch to read new comments. Default crushes redundant comments and huge pasted bodies (SmartCrusher-style; small unique tickets pass through). Pass include=full for the uncompressed vendor payload. Uses Account gh.',
    { id: z.string(), include: mcpIssueIncludeSchema, repoPath: repoPathSchema },
    async ({ id, include, repoPath }) => {
      try {
        return text(formatGitHubIssuePayload(await getGitHubIssue(id, { repoPath }), include));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'github_comment',
    'Add a markdown comment on a GitHub issue (#123 or URL). Uses Account gh. When reviewing a PR or ticket, show the draft in chat and ask_user (Post this review / Keep it in chat) first — the author sees this immediately.',
    { id: z.string(), body: z.string(), repoPath: repoPathSchema },
    async ({ id, body, repoPath }) => {
      try {
        return text(await commentGitHubIssue({ id, body }, { repoPath }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'github_update_issue',
    'Update a GitHub issue (#123). Pass title, body, and/or state (open|closed). When reviewing a PR or ticket, ask_user (Post this review / Keep it in chat) before changing the issue — the author is notified.',
    {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      state: z.string().optional().describe('open or closed'),
      repoPath: repoPathSchema,
    },
    async (args) => {
      try {
        return text(await updateGitHubIssue(args, { repoPath: args.repoPath }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'github_create_issue',
    'Create a GitHub issue. Pass parent (#123) to mark a spin-off in the body.',
    {
      title: z.string(),
      body: z.string().optional(),
      parent: z.string().optional().describe('Parent issue #123 or URL for a spin-off.'),
      repoPath: repoPathSchema,
    },
    async (args) => {
      try {
        return text(await createGitHubIssue(args, { repoPath: args.repoPath }));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
