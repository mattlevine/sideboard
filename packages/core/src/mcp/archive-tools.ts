import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatFleetArchive, listFleetArchive } from '../archive/fleet-archive.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';
import { threadsSharingWorktree } from '../threads/chat-tabs.js';
import { mcpArchiveBlockedReason } from './archive-guard.js';
import { mcpJson } from './issue-list.js';

/** Settings → History tools for orchestration: list, archive, and restore. */
export function registerArchiveTools(server: McpServer, orch: Orchestrator): void {
  server.tool(
    'list_archive',
    'Browse Settings → History (archived workspaces and agents), newest first. A workspace row is a checkout with no live agents — it is off Home and list_board. Nested lines are that workspace\'s agents; any of those ids restores the whole checkout. An agent row is an orchestration chat, or one agent archived while its workspace stayed live (workspace-live). kind=agent lists every archived agent, including agents on an archived workspace (workspace-archived). query matches title, branch, repo, agent, ticket, or PR. limit default 40, max 250. Then restore_workspace (whole checkout) or restore_chat (one agent).',
    {
      query: z
        .string()
        .optional()
        .describe('Title, branch, repo, agent, ticket, or PR'),
      kind: z
        .enum(['all', 'workspace', 'agent'])
        .optional()
        .describe('all (default), workspace, or agent'),
      limit: z
        .number()
        .int()
        .positive()
        .max(250)
        .optional()
        .describe('Page size (default 40, max 250)'),
    },
    async ({ query, kind, limit }) => {
      const view = listFleetArchive(orch.getThreads(true), { query, kind, limit });
      return { content: [{ type: 'text', text: formatFleetArchive(view) }] };
    },
  );

  server.tool(
    'archive_workspace',
    'Archive a workspace: every live agent on that checkout, then remove the worktree when the last agent archives (cowboy keeps the project folder). The Home card moves to Settings → History. Pass any chat id on the workspace. Orchestration chats are agents — use archive_chat. To archive one agent and leave the checkout up, use archive_chat.',
    { ref: z.string().describe('Any chat id on the workspace') },
    async ({ ref }) => {
      const thread = orch.getThread(ref);
      if (!thread) {
        return { content: [{ type: 'text', text: `Chat not found: ${ref}` }], isError: true };
      }
      for (const chat of threadsSharingWorktree(thread.worktreePath)) {
        const blocked = mcpArchiveBlockedReason(chat);
        if (blocked) {
          return { content: [{ type: 'text', text: blocked }], isError: true };
        }
      }
      try {
        const archived = await orch.archiveWorkspace(ref);
        return mcpJson({
          worktreePath: thread.worktreePath,
          archived: archived.map((chat) => ({
            id: chat.id,
            title: chat.title,
            agent: chat.agent,
            status: chat.status,
            link: `sideboard://chat/${chat.id}`,
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'archive_chat',
    'Archive one agent chat: stop the turn and move that chat to Settings → History. Other agents on the workspace stay, and the worktree is removed only when this is the last agent. Orchestration chats archive without removing a project checkout. Refuses the cloud coordinator. To archive every agent on a checkout, use archive_workspace. Commit, push, and open PRs via ask_git before archiving when the work should be kept. Merge only when the user explicitly asked.',
    { ref: z.string().describe('Chat id to archive') },
    async ({ ref }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return {
          content: [{ type: 'text', text: `Chat not found: ${ref}` }],
          isError: true,
        };
      }
      const blocked = mcpArchiveBlockedReason(t);
      if (blocked) {
        return {
          content: [{ type: 'text', text: blocked }],
          isError: true,
        };
      }
      const archived = await orch.archive(ref);
      return mcpJson({
        id: archived.id,
        status: archived.status,
      });
    },
  );

  server.tool(
    'restore_workspace',
    'Restore a workspace from Settings → History: recreate the worktree if it was removed and bring every archived agent on that checkout back. Pass any chat id from list_archive. If some agents are still live, only the archived ones return to that checkout. One agent only: restore_chat. Orchestration agents: restore_chat.',
    { ref: z.string().describe('Any chat id from list_archive on that workspace') },
    async ({ ref }) => {
      try {
        const restored = await orch.restoreWorkspace(ref);
        return mcpJson({
          worktreePath: restored[0]?.worktreePath ?? null,
          restored: restored.map((chat) => ({
            id: chat.id,
            title: chat.title,
            agent: chat.agent,
            status: chat.status,
            worktreePath: chat.worktreePath,
            link: `sideboard://chat/${chat.id}`,
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'restore_chat',
    'Restore one archived agent from list_archive. Recreates the worktree when that checkout was fully archived and the folder is gone. Other archived agents on the checkout stay in History until restore_workspace or another restore_chat. Orchestration agents come back as Global chats.',
    { ref: z.string().describe('Archived chat id from list_archive') },
    async ({ ref }) => {
      try {
        const restored = await orch.restore(ref);
        return mcpJson({
          id: restored.id,
          status: restored.status,
          worktreePath: restored.worktreePath,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
}
