import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { basename } from 'node:path';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import {
  listBranches,
  listPrs,
  resolveGithubRepoSlug,
  resolveRepoRoot,
} from '../git/worktree.js';
import { listIssues } from '../integrations/issues.js';
import { listLinearIssues } from '../threads/create.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { mcpArchiveBlockedReason } from './archive-guard.js';

const MAX_ORCH_THREADS = 5;

/**
 * Sideboard MCP server — agent-facing judgment surface.
 * Deliberately excludes ready-for-review confirm_land and purge_thread.
 * Draft PRs are allowed via create_draft_pr.
 */
export async function startMcpServer(): Promise<void> {
  const orch = getOrchestrator();
  // Do not reclaim "stale running" turns — MCP runs in a separate process from
  // the desktop orchestrator that owns activeTurns. Reclaiming here falsely
  // marks live parent turns as "Process died (reconciled on startup)".
  await orch.reconcile(undefined, { reclaimStaleTurns: false });

  const server = new McpServer({
    name: 'sideboard',
    version: '0.1.0',
  });

  server.tool(
    'list_workspaces',
    'List registered Sideboard workspaces (repos). Each line is name, path, and github:owner/repo when resolvable — use path as repoPath for list_branches/list_prs/list_issues/create_thread.',
    {},
    async () => {
      const workspaces = orch.listWorkspaces();
      const lines = await Promise.all(
        workspaces.map(async (w) => {
          const slug = await resolveGithubRepoSlug(w.path).catch(() => null);
          return slug
            ? `${w.name}  ${w.path}  github:${slug}`
            : `${w.name}  ${w.path}`;
        }),
      );
      return {
        content: [
          { type: 'text', text: lines.join('\n') || '(no workspaces)' },
        ],
      };
    },
  );

  server.tool(
    'list_threads',
    'List Sideboard threads across all workspaces (one summary line each — token-frugal). Each line ends with sideboard://thread/<id> — use that URL in markdown links so the UI can open the chat.',
    {},
    async () => {
      const threads = orch.getThreads(true);
      const lines = threads.map((t) => {
        const repo =
          t.repoPath === GLOBAL_WORKSPACE_ID
            ? 'Orchestration'
            : basename(t.repoPath) || t.repoPath;
        return `${t.id.slice(0, 8)}  ${t.status.padEnd(9)}  ${t.agent.padEnd(8)}  ${repo}  ${t.sourceType}:${t.sourceRef}  ${t.title}  sideboard://thread/${t.id}${t.devPort ? `  http://localhost:${t.devPort}` : ''}`;
      });
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
    'Create a new worktree thread (chat) from branch, pr, or ticket. Pass repoPath from list_workspaces and parentThreadId when spawning from an orchestrator. Then use send_to_thread to chat.',
    {
      sourceType: z.enum(['branch', 'pr', 'ticket']),
      sourceRef: z.string(),
      agent: z.enum(['claude', 'codex', 'opencode', 'brightsy', 'cursor']),
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
              link: `sideboard://thread/${thread.id}`,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'send_to_thread',
    'Queue a prompt on a worktree thread chat (runs under concurrency cap). Use after create_thread to start or continue a conversation. Set force_stop=true to interrupt an in-flight/queued turn (kill + clear queue) before queueing this prompt — use when the thread is mid-turn or has stale queued prompts you need to replace.',
    {
      ref: z.string(),
      prompt: z.string(),
      force_stop: z.boolean().optional(),
    },
    async ({ ref, prompt, force_stop }) => {
      if (force_stop) {
        const existing = orch.getThread(ref);
        if (existing) {
          orch.stop(ref, { clearQueue: true });
        }
      }
      const thread = await orch.send(ref, prompt);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: thread.id,
              status: thread.status,
              queueLength: thread.queue.length,
              forceStopped: Boolean(force_stop),
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'wait_for_turn',
    'Block until the thread finishes its current/queued turn (avoids polling). Use after send_to_thread to read the agent reply.',
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
    'stop_thread',
    'Force-stop a thread: kill any in-flight agent turn AND clear queued prompts so drainQueue cannot continue. Does not archive the worktree. Optional force defaults to true.',
    {
      ref: z.string(),
      force: z.boolean().optional(),
    },
    async ({ ref, force }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return {
          content: [{ type: 'text', text: `Thread not found: ${ref}` }],
          isError: true,
        };
      }
      const clearQueue = force !== false;
      const hadQueued = t.queue.length > 0;
      const stopped = orch.stop(ref, { clearQueue });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: stopped.id,
              status: stopped.status,
              clearedQueue: clearQueue && hadQueued,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'archive_thread',
    'Archive a thread (stops agent/dev, runs archive script, removes worktree when last chat tab). Cannot archive the cloud coordinator — use the Sideboard UI for that.',
    { ref: z.string() },
    async ({ ref }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return {
          content: [{ type: 'text', text: `Thread not found: ${ref}` }],
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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: archived.id,
              status: archived.status,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'restore_thread',
    'Restore an archived thread (recreates worktree from branch when needed)',
    { ref: z.string() },
    async ({ ref }) => {
      try {
        const restored = await orch.restore(ref);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: restored.id,
                status: restored.status,
                worktreePath: restored.worktreePath,
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
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
    'Start a .sideboard/.conductor run script for a thread (default script if name omitted); returns port',
    {
      ref: z.string(),
      name: z.string().optional(),
    },
    async ({ ref, name }) => {
      const result = await orch.startDev(ref, name);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              port: result.port,
              scriptName: result.scriptName,
              ports: result.ports,
              url: `http://localhost:${result.port}`,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'list_run_scripts',
    'List named run scripts available for a thread',
    { ref: z.string() },
    async ({ ref }) => {
      const scripts = orch.listThreadRunScripts(ref);
      const active = orch.getActiveRuns(ref);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ scripts, active }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'stop_dev_script',
    'Stop a running script for a thread (all scripts if name omitted)',
    {
      ref: z.string(),
      name: z.string().optional(),
    },
    async ({ ref, name }) => {
      orch.stopDev(ref, name);
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  );

  server.tool(
    'run_setup',
    'Re-run workspace setup (Sideboard/Conductor settings or .cursor/worktrees.json)',
    { ref: z.string() },
    async ({ ref }) => {
      const result = await orch.runSetup(ref);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'add_workspace',
    'Register a git repo as a Sideboard workspace',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      const ws = await orch.addWorkspace(repoPath);
      return { content: [{ type: 'text', text: JSON.stringify(ws) }] };
    },
  );

  server.tool(
    'remove_workspace',
    'Unregister a Sideboard workspace (does not archive threads)',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      orch.removeWorkspace(repoPath);
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  );

  server.tool(
    'fanout',
    'Best-of-n: create one thread per agent with the same prompt (parallel attempts)',
    {
      prompt: z.string(),
      agents: z.array(z.enum(['claude', 'codex', 'opencode', 'brightsy', 'cursor'])),
      repoPath: z.string(),
      sourceType: z.enum(['branch', 'pr', 'ticket']).optional(),
      sourceRef: z.string().optional(),
      title: z.string().optional(),
    },
    async (args) => {
      const threads = await orch.bestOfN(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              threads.map((t) => ({
                id: t.id,
                agent: t.agent,
                branchName: t.branchName,
                worktreePath: t.worktreePath,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'preview_land',
    'Preview push+PR land (does NOT push). Use before create_draft_pr.',
    { ref: z.string() },
    async ({ ref }) => {
      const preview = await orch.previewLand(ref);
      return { content: [{ type: 'text', text: JSON.stringify(preview, null, 2) }] };
    },
  );

  server.tool(
    'create_draft_pr',
    'Commit dirty changes if needed, push the thread branch, and create/update a DRAFT GitHub PR. Ready-for-review / non-draft land stays human-only (CLI/app confirm_land). Prefer this when the orchestrator should open a PR itself; alternatively send_to_thread asking the worktree agent to run `gh pr create --draft`.',
    { ref: z.string() },
    async ({ ref }) => {
      try {
        const result = await orch.confirmLand(ref, { draft: true });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  prUrl: result.prUrl,
                  pushed: result.pushed,
                  committed: result.committed,
                  draft: true,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'list_branches',
    'List git branches in a registered workspace. Pass repoPath from list_workspaces (unmerged into the default branch by default — for create_thread sourceType=branch).',
    {
      repoPath: z.string(),
      unmergedOnly: z.boolean().optional(),
    },
    async ({ repoPath, unmergedOnly }) => {
      const root = await resolveRepoRoot(repoPath);
      const branches = await listBranches(root, {
        unmergedOnly: unmergedOnly !== false,
      });
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
    'List open GitHub PRs for a registered workspace. Pass repoPath from list_workspaces (uses gh against that repo remote). Then create_thread with sourceType=pr.',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      const root = await resolveRepoRoot(repoPath);
      const prs = await listPrs(root);
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
    'list_issues',
    'List issues from Sideboard Account connections (Linear API or GitHub Issues; Linear→GitHub fallback when Linear is not connected). Pass repoPath from list_workspaces — GitHub Issues are scoped to that repo. Then create_thread with sourceType=ticket.',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      const root = await resolveRepoRoot(repoPath);
      const result = await listIssues(root);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'list_linear_issues',
    'Deprecated: prefer list_issues. Lists assigned Linear issues via the chosen agent MCP connector',
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
