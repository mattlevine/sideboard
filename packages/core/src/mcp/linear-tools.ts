import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  commentLinearIssue,
  createLinearIssue,
  getLinearIssue,
  listLinearIssuesFiltered,
  listLinearTeams,
  updateLinearIssue,
} from '../integrations/linear.js';
import {
  applyIssueListWindow,
  clampMcpIssueLimit,
  formatMcpIssueList,
  mcpJson,
} from './issue-list.js';

function text(payload: unknown, isError = false) {
  return mcpJson(payload, isError);
}

function fail(err: unknown) {
  return text(
    { error: err instanceof Error ? err.message : String(err) },
    true,
  );
}

const prioritySchema = z
  .number()
  .int()
  .min(0)
  .max(4)
  .optional()
  .describe('0 none, 1 urgent, 2 high, 3 medium, 4 low');

/**
 * Linear ticket tools on the Sideboard MCP server (Account OAuth / API key).
 * Call linear_list_teams first when creating; pass ENG-123 or uuid as id.
 */
export function registerLinearTools(server: McpServer): void {
  server.tool(
    'linear_list_teams',
    'List Linear teams (id, key, name) and workflow states. Use team key on create; state name or type on create/update.',
    {},
    async () => {
      try {
        return text(await listLinearTeams());
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'linear_search_issues',
    'Search or list open Linear issues. Default 40; pass query and/or limit (max 250) when truncated. assignee: me, unassigned, all (default with query), or a user id/name.',
    {
      query: z
        .string()
        .optional()
        .describe('Search text (identifier, title, description). Omit to list by assignee only.'),
      assignee: z
        .string()
        .optional()
        .describe('me, unassigned, all, a Linear user id, or a display name. Default: all when query is set, otherwise me.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(250)
        .optional()
        .describe('Page size (default 40, max 250). Raise when truncated is true.'),
    },
    async ({ query, assignee, limit }) => {
      try {
        const page = clampMcpIssueLimit(limit);
        const listed = await listLinearIssuesFiltered({
          query,
          assignee,
          limit: page + 1,
        });
        const windowed = applyIssueListWindow(listed.issues, page);
        return mcpJson(
          formatMcpIssueList({
            source: 'linear',
            viewer: listed.viewer.name,
            limit: page,
            issues: windowed.items,
            truncated: windowed.truncated,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'linear_get_issue',
    'Get a Linear issue by uuid or identifier (ENG-123): description, comments, relations, parent/children.',
    { id: z.string() },
    async ({ id }) => {
      try {
        return text(await getLinearIssue(id));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'linear_create_issue',
    'Create a Linear issue. Call linear_list_teams first. team is id/key/name; state is name/type/id; assignee is "me" or a user id.',
    {
      team: z.string(),
      title: z.string(),
      description: z.string().optional(),
      state: z.string().optional(),
      assignee: z.string().nullable().optional(),
      priority: prioritySchema,
    },
    async (args) => {
      try {
        return text(await createLinearIssue(args));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'linear_update_issue',
    'Update a Linear issue (uuid or ENG-123). Pass title, description, state, assignee, and/or priority.',
    {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      state: z.string().optional(),
      assignee: z.string().nullable().optional(),
      priority: prioritySchema,
    },
    async (args) => {
      try {
        return text(await updateLinearIssue(args));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'linear_comment',
    'Add a markdown comment on a Linear issue (uuid or ENG-123).',
    {
      id: z.string(),
      body: z.string(),
    },
    async (args) => {
      try {
        return text(await commentLinearIssue(args));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
