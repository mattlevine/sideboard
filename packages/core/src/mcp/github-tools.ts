import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  commentGitHubIssue,
  createGitHubIssue,
  getGitHubIssue,
  updateGitHubIssue,
} from '../integrations/github-issues.js';
import { mcpJson } from './issue-list.js';
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
    'Add a markdown comment on a GitHub issue (#123 or URL). Uses Account gh. When reviewing someone else\'s PR, show the draft in chat and ask_user (Post this review / Keep it in chat) first — the author sees this immediately.',
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
    'Update a GitHub issue (#123). Pass title, body, and/or state (open|closed). When reviewing someone else\'s PR, ask_user (Post this review / Keep it in chat) before changing the issue — the author is notified.',
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
