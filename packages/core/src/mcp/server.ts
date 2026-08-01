import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { listBranches, listPrs } from '../git/worktree.js';
import { listLinearIssues } from '../threads/create.js';

const MAX_ORCH_THREADS = 5;

/**
 * Sideboard MCP server — agent-facing judgment surface.
 * Deliberately excludes confirm_land and purge_thread.
 */
export async function startMcpServer(): Promise<void> {
  const orch = getOrchestrator();
  await orch.reconcile();

  const server = new McpServer({
    name: 'sideboard',
    version: '0.1.0',
  });

  server.tool(
    'list_threads',
    'List Sideboard threads (one summary line each — token-frugal)',
    {},
    async () => {
      const threads = orch.getThreads(true);
      const lines = threads.map(
        (t) =>
          `${t.id.slice(0, 8)}  ${t.status.padEnd(9)}  ${t.agent.padEnd(8)}  ${t.sourceType}:${t.sourceRef}  ${t.title}${t.devPort ? `  http://localhost:${t.devPort}` : ''}`,
      );
      return {
        content: [{ type: 'text', text: lines.join('\n') || '(no threads)' }],
      };
    },
  );

  server.tool(
    'get_thread',
    'Get a compact thread summary by id/ref',
    { ref: z.string() },
    async ({ ref }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return { content: [{ type: 'text', text: `Thread not found: ${ref}` }], isError: true };
      }
      const summary = {
        id: t.id,
        title: t.title,
        status: t.status,
        agent: t.agent,
        sourceType: t.sourceType,
        sourceRef: t.sourceRef,
        branchName: t.branchName,
        worktreePath: t.worktreePath,
        sessionId: t.sessionId,
        queueLength: t.queue.length,
        messageCount: t.messages.length,
        devPort: t.devPort,
        prUrl: t.prUrl,
        lastError: t.lastError ?? null,
      };
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.tool(
    'create_thread',
    'Create a new thread from branch, pr, or ticket',
    {
      sourceType: z.enum(['branch', 'pr', 'ticket']),
      sourceRef: z.string(),
      agent: z.enum(['claude', 'codex', 'opencode']),
      repoPath: z.string(),
      title: z.string().optional(),
      parentThreadId: z.string().optional(),
    },
    async (args) => {
      if (args.parentThreadId) {
        const children = orch
          .getThreads(true)
          .filter((t) => t.parentThreadId === args.parentThreadId);
        if (children.length >= MAX_ORCH_THREADS) {
          return {
            content: [
              {
                type: 'text',
                text: `Thread-creation cap (${MAX_ORCH_THREADS}) reached for this orchestration session`,
              },
            ],
            isError: true,
          };
        }
      }
      const thread = await orch.createThread({
        sourceType: args.sourceType,
        sourceRef: args.sourceRef,
        agent: args.agent,
        repoPath: args.repoPath,
        title: args.title,
        parentThreadId: args.parentThreadId ?? null,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: thread.id,
              title: thread.title,
              branchName: thread.branchName,
              worktreePath: thread.worktreePath,
              status: thread.status,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'send_to_thread',
    'Queue a prompt on a thread (runs under concurrency cap)',
    {
      ref: z.string(),
      prompt: z.string(),
    },
    async ({ ref, prompt }) => {
      const thread = await orch.send(ref, prompt);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: thread.id,
              status: thread.status,
              queueLength: thread.queue.length,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'wait_for_turn',
    'Block until the thread finishes its current/queued turn (avoids polling)',
    {
      ref: z.string(),
      timeoutMs: z.number().optional(),
    },
    async ({ ref, timeoutMs }) => {
      const thread = await orch.waitForTurn(ref, timeoutMs ?? 600_000);
      const result = orch.getTurnResult(thread.id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: thread.id,
              status: result.status,
              text: result.text,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'get_turn_result',
    'Final assistant message only (not full transcript)',
    { ref: z.string() },
    async ({ ref }) => {
      const result = orch.getTurnResult(ref);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'get_diff',
    'Compact diff summary (capped hunks, paginated)',
    {
      ref: z.string(),
      maxFiles: z.number().optional(),
    },
    async ({ ref, maxFiles }) => {
      const summary = await orch.diffSummary(ref);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...summary,
              files: summary.files.slice(0, maxFiles ?? 10),
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'run_dev_script',
    'Start the .conductor default run script for a thread; returns port',
    { ref: z.string() },
    async ({ ref }) => {
      const { port } = await orch.startDev(ref);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ port, url: `http://localhost:${port}` }),
          },
        ],
      };
    },
  );

  server.tool(
    'preview_land',
    'Preview push+PR land (does NOT confirm — humans must confirm via CLI/app)',
    { ref: z.string() },
    async ({ ref }) => {
      const preview = await orch.previewLand(ref);
      return { content: [{ type: 'text', text: JSON.stringify(preview, null, 2) }] };
    },
  );

  server.tool(
    'list_branches',
    'List git branches in a repo',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      const branches = await listBranches(repoPath);
      return {
        content: [
          {
            type: 'text',
            text: branches.map((b) => `${b.current ? '*' : ' '} ${b.name}`).join('\n'),
          },
        ],
      };
    },
  );

  server.tool(
    'list_prs',
    'List open PRs via gh',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      const prs = await listPrs(repoPath);
      return {
        content: [
          {
            type: 'text',
            text: prs
              .map(
                (p) =>
                  `#${p.number} ${p.title} (${p.headRefName})${p.isCrossRepository ? ' [fork]' : ''}`,
              )
              .join('\n'),
          },
        ],
      };
    },
  );

  server.tool(
    'list_linear_issues',
    'List assigned Linear issues via the chosen agent MCP connector',
    {
      agent: z.enum(['claude', 'codex', 'opencode']),
      repoPath: z.string(),
    },
    async ({ agent, repoPath }) => {
      const issues = await listLinearIssues(agent, repoPath);
      return { content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
