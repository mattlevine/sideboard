import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  deleteEnvVar,
  listEnvKeys,
  projectEnvPrefix,
  projectNameForRepoPath,
  setEnvVar,
  type EnvScope,
} from '../store/env-vars.js';
import { mcpJson } from './issue-list.js';


function text(payload: unknown, isError = false) {
  return mcpJson(payload, isError);
}

const PROJECT_PATH_HINT =
  'Pass repoPath from list_projects. Orchestration cwd is synthetic — do not omit repoPath for scope=project. Worktree turns may omit it (uses cwd).';

async function projectFor(repoPath?: string): Promise<{ name: string; prefix: string } | null> {
  const hint = repoPath?.trim() || process.cwd();
  const name = projectNameForRepoPath(hint);
  if (!name) return null;
  return { name, prefix: projectEnvPrefix(name) };
}

export const ENV_MCP_TOOLS = ['list_env', 'set_env', 'delete_env'] as const;

export function registerEnvTools(server: McpServer): void {
  server.tool(
    'list_env',
    'List Settings → Environment variable names (not values). scope=project keys use the project prefix (project name, uppercased, plus _). scope=account keys are shared by every project. Pass repoPath from list_projects when calling from orchestration so the reply includes this project prefix.',
    {
      repoPath: z
        .string()
        .optional()
        .describe(
          'Registered workspace or worktree path. Required from orchestration. Omit on a worktree turn (uses cwd).',
        ),
    },
    async ({ repoPath }) => {
      try {
        const project = await projectFor(repoPath);
        return text({
          project: project?.name ?? null,
          prefix: project?.prefix ?? null,
          keys: listEnvKeys(),
        });
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  server.tool(
    'set_env',
    'Set a Settings → Environment variable. scope=project prefixes the key with the project name (APPLE_ID on project sideboard is stored as SIDEBOARD_APPLE_ID). scope=account stores the key unchanged and is shared by every project. Values are injected into later agent turns. list_env does not return values.',
    {
      key: z.string().describe('Env name. For scope=project, pass the bare name or the already-prefixed name.'),
      value: z.string().describe('Value to store. Empty deletes the key.'),
      scope: z
        .enum(['account', 'project'])
        .describe('project = prefixed for one repo; account = shared by every project'),
      repoPath: z
        .string()
        .optional()
        .describe(
          'Required for scope=project from orchestration (path from list_projects). Worktree turns may omit it (cwd).',
        ),
    },
    async ({ key, value, scope, repoPath }) => {
      try {
        const envScope = scope as EnvScope;
        if (envScope === 'project') {
          const project = await projectFor(repoPath);
          if (!project) return text({ ok: false, error: 'repoPath required', message: PROJECT_PATH_HINT }, true);
          const saved = setEnvVar({
            key,
            value,
            scope: 'project',
            projectName: project.name,
          });
          return text({ ok: true, ...saved });
        }
        const saved = setEnvVar({ key, value, scope: 'account' });
        return text({ ok: true, ...saved });
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  server.tool(
    'delete_env',
    'Delete a Settings → Environment variable. scope=project uses the project prefix (same rule as set_env). Does not print the stored value.',
    {
      key: z.string().describe('Env name. For scope=project, pass the bare name or the already-prefixed name.'),
      scope: z.enum(['account', 'project']),
      repoPath: z
        .string()
        .optional()
        .describe(
          'Required for scope=project from orchestration (path from list_projects). Worktree turns may omit it (cwd).',
        ),
    },
    async ({ key, scope, repoPath }) => {
      try {
        const envScope = scope as EnvScope;
        if (envScope === 'project') {
          const project = await projectFor(repoPath);
          if (!project) return text({ ok: false, error: 'repoPath required', message: PROJECT_PATH_HINT }, true);
          const removed = deleteEnvVar({
            key,
            scope: 'project',
            projectName: project.name,
          });
          return text({ ok: true, ...removed });
        }
        const removed = deleteEnvVar({ key, scope: 'account' });
        return text({ ok: true, ...removed });
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );
}
