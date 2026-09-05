import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  commentGitHubIssue,
  createGitHubIssue,
  getGitHubIssue,
  updateGitHubIssue,
} from '../integrations/github-issues.js';
import { mcpJson } from './issue-list.js';

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
    'Get a GitHub issue (#123 or URL): body, comments, state. Re-fetch to read new comments. Uses Account gh.',
    { id: z.string(), repoPath: repoPathSchema },
    async ({ id, repoPath }) => {
      try {
        return text(await getGitHubIssue(id, { repoPath }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'github_comment',
    'Add a markdown comment on a GitHub issue (#123 or URL). Uses Account gh.',
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
    'Update a GitHub issue (#123). Pass title, body, and/or state (open|closed).',
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
