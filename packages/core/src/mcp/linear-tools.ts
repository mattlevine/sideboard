import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  commentLinearIssue,
  createLinearIssue,
  getLinearIssue,
  listLinearTeams,
  updateLinearIssue,
} from '../integrations/linear.js';

function text(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
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
    'List Linear teams (id, key, name) and workflow states for the connected Account. Use team key (e.g. ENG) on linear_create_issue; use state name or type (started, completed) on create/update. Viewer id is for assignee=me.',
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
    'linear_get_issue',
    'Get a Linear issue by uuid or identifier (ENG-123). Returns description, comments, relations (blocks/blockedBy/related/duplicate), parent/children, project, cycle, labels, and other metadata.',
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
    'Create a Linear issue. Call linear_list_teams first. team is id, key, or name. state is name, type (unstarted/started/completed/canceled/backlog), or id. assignee is "me" or a user id.',
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
    'Update a Linear issue (uuid or ENG-123). Pass at least one of title, description, state, assignee, priority. state is name, type, or id. assignee is "me", a user id, or null to unassign.',
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
