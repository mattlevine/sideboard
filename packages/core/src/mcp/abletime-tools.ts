import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createAbleTimeTask,
  ensureAbleTimeTask,
  getAbleTimeOrientation,
  getAbleTimeTask,
  listAbleTimeProjects,
  listAbleTimeTasks,
  searchAbleTimeTasks,
  toAbleTimeIssueInfo,
} from '../integrations/abletime.js';

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

/**
 * AbleTime tools on the Sideboard MCP server (Account personal access token).
 * Hosted AbleTime MCP is at POST https://track.abletime.com/api/public/v2/mcp.
 */
export function registerAbleTimeTools(server: McpServer): void {
  server.tool(
    'abletime_orientation',
    'Call first when using AbleTime. Returns who the Account token is, open drafts, active tasks, and current projects. Requires Agent access (MCP) enabled in AbleTime.',
    {},
    async () => {
      try {
        const orientation = await getAbleTimeOrientation();
        return text({
          viewer: orientation.viewer,
          projects: orientation.projects,
          tasks: orientation.tasks.map(toAbleTimeIssueInfo),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_list_projects',
    'List AbleTime projects (and categories) the Account token can see. Use a project id on abletime_create_task / abletime_ensure_task.',
    {},
    async () => {
      try {
        return text({ projects: await listAbleTimeProjects() });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_list_tasks',
    'List open AbleTime tasks (excludes done/archived). Optional projectId filter.',
    { projectId: z.string().optional() },
    async ({ projectId }) => {
      try {
        const tasks = await listAbleTimeTasks({ projectId });
        return text({ issues: tasks.map(toAbleTimeIssueInfo) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_search_tasks',
    'Search AbleTime tasks by text, reference, or tag.',
    { query: z.string() },
    async ({ query }) => {
      try {
        const tasks = await searchAbleTimeTasks(query);
        return text({ issues: tasks.map(toAbleTimeIssueInfo) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_get_task',
    'Get one AbleTime task by id or reference (e.g. CRM-232).',
    { id: z.string() },
    async ({ id }) => {
      try {
        return text(toAbleTimeIssueInfo(await getAbleTimeTask(id)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_create_task',
    'Create an AbleTime task in a project. Call abletime_list_projects if you do not have a project id. New tasks start in todo (or backlog).',
    {
      title: z.string(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      categoryId: z.string().optional(),
      state: z.enum(['backlog', 'todo']).optional(),
    },
    async (args) => {
      try {
        return text(toAbleTimeIssueInfo(await createAbleTimeTask(args)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_ensure_task',
    'Find an open AbleTime task for this work, or create one to track against. Matches identifier or exact title before creating. Prefer this when starting work that has no ticket yet, then create_thread with sourceType=ticket and the returned identifier.',
    {
      title: z.string(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      categoryId: z.string().optional(),
    },
    async (args) => {
      try {
        const task = await ensureAbleTimeTask(args);
        return text({ ...toAbleTimeIssueInfo(task), created: task.created });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
