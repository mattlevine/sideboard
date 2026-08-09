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
import { listModelsForAgent } from '../agents/list-models.js';
import { mcpArchiveBlockedReason } from './archive-guard.js';

const MAX_ORCH_THREADS = 5;

/**
 * Sideboard MCP server — agent-facing judgment surface.
 * Deliberately excludes ready-for-review confirm_land, purge_thread, and
 * host-owned draft PR creation. Orchestrators ask worktree agents to open PRs.
 */
export async function startMcpServer(): Promise<void> {
  const orch = getOrchestrator();
  // Do not reclaim "stale running" turns — MCP runs in a separate process from
  // the desktop orchestrator that owns activeTurns. Reclaiming here falsely
  // marks live parent turns as "Process died (reconciled on startup)".
  // (reclaimStaleTurns defaults to false; keep the flag explicit for clarity.)
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
    'present_artifact',
    'Show an HTML, SVG, markdown, or React document in Sideboard’s Claude-style side column (desktop). Use instead of claude.ai’s artifact tool — pass the full document content. Prefer type=html for interactive pages. For type=react, pass a single component module that `export default`s a component (JSX/TSX ok) — Sideboard bootstraps React/ReactDOM/Babel and renders it; only `react`/`react-dom` imports are available, no other npm packages.',
    {
      title: z.string().describe('Short title shown in the artifact pane header'),
      type: z
        .enum(['html', 'svg', 'markdown', 'react'])
        .describe(
          'Artifact kind — html opens an iframe preview; react transpiles and renders a default-exported component in a sandboxed iframe',
        ),
      content: z
        .string()
        .describe(
          'Full document body (complete HTML page, SVG markup, markdown, or a React component module with a default export)',
        ),
      artifact_id: z
        .string()
        .optional()
        .describe('Stable id when updating the same artifact across turns'),
    },
    async ({ title, type, content, artifact_id }) => {
      const id =
        artifact_id?.trim() ||
        `artifact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      // Echo the payload so Sideboard’s stream parser can open the side column from
      // the tool_use input / tool_result (MCP has no direct UI channel).
      const payload = {
        ok: true,
        artifact_id: id,
        title,
        type,
        content,
        message:
          'Artifact accepted. Sideboard desktop opens it in the side column beside chat.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    'present_schema',
    'Open Sideboard’s schema-driven CMS side column (filterable table and/or form). Pass JSON Schema + schemaUi (Brightsy extensions supported). Use datasource=brightsy with resource_id (record type UUID) when logged into Brightsy; use datasource=inline with embedded resource/records for any other source.',
    {
      title: z.string().describe('Pane title'),
      mode: z
        .enum(['table', 'form'])
        .optional()
        .describe('table = list/filter records; form = edit one record'),
      datasource: z
        .enum(['brightsy', 'inline'])
        .optional()
        .describe('brightsy resolves via login; inline uses embedded resource/records'),
      resource_id: z
        .string()
        .optional()
        .describe('Brightsy record type UUID (or generic resource id)'),
      record_id: z.string().optional().describe('Record id when opening form mode'),
      resource: z
        .record(z.unknown())
        .optional()
        .describe('Inline { id, title, schema, schemaUi?, slug? }'),
      record: z.record(z.unknown()).optional().describe('Inline record { id, data, published_at? }'),
      records: z
        .array(z.record(z.unknown()))
        .optional()
        .describe('Inline records for table mode'),
      pane_id: z.string().optional().describe('Stable pane id across updates'),
    },
    async (args) => {
      const id =
        args.pane_id?.trim() ||
        `schema_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        ok: true,
        pane_id: id,
        title: args.title,
        mode: args.mode ?? (args.record_id || args.record ? 'form' : 'table'),
        datasource: args.datasource ?? (args.resource ? 'inline' : 'brightsy'),
        resource_id: args.resource_id,
        record_id: args.record_id,
        resource: args.resource,
        record: args.record,
        records: args.records,
        message:
          'Schema pane accepted. Sideboard desktop opens the CMS column beside chat.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    'present_files',
    'Open Sideboard’s Files column (CMS-style file manager: browse, upload, pick). Use datasource=brightsy when the user is logged into Brightsy account storage; datasource=memory for a session-local demo store. Prefer this over claiming a file manager UI is unavailable. Pair with present_schema when editing records that need media.',
    {
      title: z.string().optional().describe('Pane title (default: Files)'),
      datasource: z
        .enum(['brightsy', 'memory'])
        .optional()
        .describe('brightsy = account storage via login; memory = session demo store'),
      path: z.string().optional().describe('Initial folder path (e.g. public)'),
      pane_id: z.string().optional().describe('Stable pane id across updates'),
    },
    async (args) => {
      const id =
        args.pane_id?.trim() ||
        `files_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        ok: true,
        pane_id: id,
        title: args.title?.trim() || 'Files',
        datasource: args.datasource ?? 'brightsy',
        path: args.path,
        message:
          'Files pane accepted. Sideboard desktop opens the Files column beside chat.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
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
    'request_review',
    'Start a merge-readiness Review on a worktree agent thread (same as the desktop Review button). Opens a new Review chat tab, optionally attaches .sideboard/attachments/Review request.md when present, and asks for Approve / Approve with nits / Request changes / Needs more information. Pass a worktree thread ref — not the orchestrator. Then wait_for_turn / get_turn_result on the returned review tab id.',
    { ref: z.string().describe('Worktree thread id/ref to review') },
    async ({ ref }) => {
      try {
        const tab = await orch.requestReview(ref);
        const from = orch.getThread(ref);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: tab.id,
                title: tab.title,
                status: tab.status,
                fromThreadId: from?.id ?? ref,
                link: `sideboard://thread/${tab.id}`,
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

  const agentEnum = z.enum(['claude', 'codex', 'opencode', 'brightsy', 'cursor']);

  server.tool(
    'list_models',
    'List models for an agent. Prefer Auto: do not call this unless you have a reason to pin a specific model (user request, cost/latency, capability). Omit agent to list all.',
    {
      agent: agentEnum.optional().describe('Limit to one agent; omit for all'),
    },
    async ({ agent }) => {
      try {
        const catalogs = await listModelsForAgent(agent);
        return {
          content: [{ type: 'text', text: JSON.stringify(catalogs, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'fork_worktree',
    'Fork a worktree agent chat into a NEW git worktree + chat (desktop “Fork to new workspace”). Seeds a transcript (through through_index, default all). Optional agent override. Leave model unset for Auto (default) — only pass model when you have a reason. Not for the orchestrator. Then send_to_thread / wait_for_turn on the returned id.',
    {
      ref: z.string().describe('Worktree thread id/ref to fork'),
      through_index: z
        .number()
        .optional()
        .describe('Inclusive message index to include in the transcript (default: all)'),
      agent: agentEnum.optional().describe('Agent for the forked chat (default: same as source)'),
      model: z
        .string()
        .nullable()
        .optional()
        .describe('Usually omit (Auto). Only set from list_models when you need a specific model'),
      title: z.string().optional(),
    },
    async ({ ref, through_index, agent, model, title }) => {
      try {
        const source = orch.getThread(ref);
        if (source) await orch.reconcile(source.repoPath);
        const thread = await orch.forkThreadWorktree({
          threadId: ref,
          throughIndex: through_index,
          agent,
          model,
          title,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: thread.id,
                title: thread.title,
                status: thread.status,
                agent: thread.agent,
                model: thread.model,
                branchName: thread.branchName,
                worktreePath: thread.worktreePath,
                fromThreadId: source?.id ?? ref,
                link: `sideboard://thread/${thread.id}`,
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
    'fork_chat',
    'Fork a chat into a NEW tab on the SAME workspace: worktree agent → same worktree tab; Global orchestration chat → new orchestration chat (same synthetic home). Seeds a transcript; optional agent override. Leave model unset for Auto unless you have a reason. Remote coordinators use this to continue an orchestration chat on another agent after session limits. Then send_to_thread / wait_for_turn on the returned id. Use fork_worktree only for worktree agents that need a new git worktree.',
    {
      ref: z.string().describe('Thread id/ref to fork (worktree agent or orchestration chat)'),
      through_index: z
        .number()
        .optional()
        .describe('Inclusive message index to include in the transcript (default: all)'),
      agent: agentEnum.optional().describe('Agent for the forked chat (default: same as source)'),
      model: z
        .string()
        .nullable()
        .optional()
        .describe('Usually omit (Auto). Only set from list_models when you need a specific model'),
      title: z.string().optional(),
    },
    async ({ ref, through_index, agent, model, title }) => {
      try {
        const source = orch.getThread(ref);
        if (!source) {
          return {
            content: [{ type: 'text', text: `Thread not found: ${ref}` }],
            isError: true,
          };
        }
        const tab = orch.forkChatTab({
          threadId: source.id,
          throughIndex: through_index,
          agent,
          model,
          title,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: tab.id,
                title: tab.title,
                status: tab.status,
                agent: tab.agent,
                model: tab.model,
                sourceType: tab.sourceType,
                worktreePath: tab.worktreePath,
                fromThreadId: source.id,
                link: `sideboard://thread/${tab.id}`,
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
