import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  commentAbleTimeTask,
  createAbleTimeTask,
  ensureAbleTimeTask,
  getAbleTimeOrientation,
  getAbleTimeTask,
  listAbleTimeProjects,
  listAbleTimeTasks,
  searchAbleTimeTasks,
  toAbleTimeIssueInfo,
  updateAbleTimeTask,
} from '../integrations/abletime.js';
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

export const ABLETIME_MCP_TOOL_NAMES = [
  'abletime_orientation',
  'abletime_list_projects',
  'abletime_list_tasks',
  'abletime_search_tasks',
  'abletime_get_task',
  'abletime_comment',
  'abletime_update_task',
  'abletime_create_task',
  'abletime_ensure_task',
] as const;

/**
 * AbleTime tools on the Sideboard MCP server (Account personal access token).
 * Hosted AbleTime MCP is at POST https://track.abletime.com/api/public/v2/mcp.
 */
export function registerAbleTimeTools(server: McpServer): void {
  server.tool(
    'abletime_orientation',
    'Call first when using AbleTime. Returns viewer, active tasks, and projects.',
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
    'List AbleTime projects (and categories). Use a project id on create/ensure.',
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
    'Get one AbleTime task by id or reference (e.g. CRM-232): description, state, comments. Re-fetch to read new comments.',
    { id: z.string() },
    async ({ id }) => {
      try {
        const task = await getAbleTimeTask(id);
        return text({
          ...toAbleTimeIssueInfo(task),
          description: task.description,
          state: task.state,
          comments: task.comments,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_comment',
    'Add a markdown comment on an AbleTime task (id or CRM-232).',
    { id: z.string(), body: z.string() },
    async (args) => {
      try {
        return text(await commentAbleTimeTask(args));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_update_task',
    'Update an AbleTime task (id or CRM-232). Pass title, description, and/or state.',
    {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      state: z.string().optional(),
    },
    async (args) => {
      try {
        const task = await updateAbleTimeTask(args);
        return text({
          ...toAbleTimeIssueInfo(task),
          description: task.description,
          state: task.state,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'abletime_create_task',
    'Create an AbleTime task in a project. Call abletime_list_projects if you do not have a project id. Pass parent (CRM-232) for a spin-off. New tasks start in todo (or backlog).',
    {
      title: z.string(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      categoryId: z.string().optional(),
      state: z.enum(['backlog', 'todo']).optional(),
      parent: z
        .string()
        .optional()
        .describe('Parent task id or reference (CRM-232) for a spin-off.'),
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
    'Find or create an AbleTime task for this work, then create_thread with sourceType=ticket.',
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
