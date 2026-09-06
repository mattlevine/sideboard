import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveRepoRoot } from '../git/worktree.js';
import {
  readViewerContext,
  writeViewerContext,
} from '../store/app-settings.js';
import { listWorkspaces } from '../store/workspaces.js';
import { mcpJson } from './issue-list.js';

function text(payload: unknown, isError = false) {
  return mcpJson(payload, isError);
}

/** Map a repo / worktree path (or cwd) to a registered workspace root. */
export function matchRegisteredWorkspace(repoPath?: string | null): string | null {
  const hint = (repoPath ?? '').trim().replace(/\/+$/, '');
  if (!hint) return null;
  let best: string | null = null;
  for (const w of listWorkspaces()) {
    const stored = w.path.replace(/\/+$/, '');
    // Exact or descendant (worktree). Do not match a parent of a registered repo —
    // `/Users/me` must not pick the first workspace under it.
    if (stored === hint || hint.startsWith(`${stored}/`)) {
      if (!best || stored.length > best.length) best = stored;
    }
  }
  return best;
}

async function resolveProjectRepoPath(repoPath?: string): Promise<string | null> {
  const hint = repoPath?.trim() || process.cwd();
  let root = hint;
  try {
    root = await resolveRepoRoot(hint);
  } catch {
    root = hint.replace(/\/+$/, '');
  }
  return matchRegisteredWorkspace(root) ?? matchRegisteredWorkspace(hint);
}

const PROJECT_PATH_HINT =
  'Pass repoPath from list_workspaces. Orchestration cwd is synthetic and empty — do not omit repoPath for project context.';

export const VIEWER_CONTEXT_MCP_TOOLS = [
  'get_viewer_context',
  'update_viewer_context',
] as const;

export function registerViewerContextTools(server: McpServer): void {
  server.tool(
    'get_viewer_context',
    'Read account and project user context (Settings → Agents / Projects): roles, tickets, and review queues as freeform text. Orchestration must pass repoPath from list_workspaces for project context. Worktree turns may omit repoPath (uses cwd).',
    {
      repoPath: z
        .string()
        .optional()
        .describe(
          'Registered workspace or worktree path. Required from orchestration for a project. Omit on a worktree turn (uses cwd).',
        ),
    },
    async ({ repoPath }) => {
      try {
        const path = await resolveProjectRepoPath(repoPath);
        return text(readViewerContext(path ?? undefined));
      } catch (err) {
        return text(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.tool(
    'update_viewer_context',
    'Replace account or project user context (Settings → Agents / Projects). Never call until the user confirmed. Show the proposed text, ask_user (Save this context / Do not save), wait, then pass confirmed=true. Empty context clears that field.',
    {
      scope: z
        .enum(['account', 'project'])
        .describe('account = Settings → Agents; project = Settings → Projects for one repo'),
      context: z
        .string()
        .describe('Full replacement text (roles, tickets, review queues). Empty clears.'),
      confirmed: z
        .boolean()
        .optional()
        .describe('Must be true after the user confirmed via ask_user. False/omit is rejected.'),
      repoPath: z
        .string()
        .optional()
        .describe(
          'Required for scope=project from orchestration (path from list_workspaces). Worktree turns may omit it (cwd).',
        ),
    },
    async ({ scope, context, confirmed, repoPath }) => {
      try {
        if (scope === 'project') {
          const path = await resolveProjectRepoPath(repoPath);
          if (!path) {
            return text(
              {
                ok: false,
                error: 'repoPath required',
                message: PROJECT_PATH_HINT,
              },
              true,
            );
          }
          const result = writeViewerContext({
            scope,
            context,
            repoPath: path,
            confirmed: confirmed === true,
          });
          return text(result, !result.ok);
        }
        const result = writeViewerContext({
          scope,
          context,
          confirmed: confirmed === true,
        });
        return text(result, !result.ok);
      } catch (err) {
        return text(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );
}
