import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import {
  listBranches,
  listPrs,
  resolveGithubRepoSlug,
  canonicalizeRepoPath,
  resolveRepoRoot,
} from '../git/worktree.js';
import { listIssues } from '../integrations/issues.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { listModelsForAgent } from '../agents/list-models.js';
import { mcpArchiveBlockedReason } from './archive-guard.js';
import { sideboardMcpProfile } from './profile.js';
import {
  mcpWaitFinishedHint,
  mcpWaitStillRunningHint,
  mcpWaitForTurnTimeoutMs,
} from './wait-for-turn.js';
import { isInternalAgentStatusText } from '../agents/message-parts.js';
import { readTurnLive } from '../store/turn-live.js';
import { childThreadRefs, lastMessagePreview } from './thread-visibility.js';
import { registerSlackTools } from './slack-tools.js';
import { registerConnectedIssueVendorTools } from './issue-vendor-tools.js';
import {
  applyIssueListWindow,
  clampMcpIssueLimit,
  formatMcpIssueList,
  mcpJson,
} from './issue-list.js';
import { formatMcpPrList } from './pr-list.js';
import { resolveListPrsOptions } from '../git/list-prs.js';
import { registerScheduleTools } from './schedule-tools.js';
import { AGENT_GIT_ACTIONS } from '../git/agent-git-actions.js';
import { formatGhLandError } from '../git/gh-errors.js';
import { warmGithubAgentAuth } from '../git/git-auth-mode.js';
import { getHomeBoardInputs } from '../board/load-home-board.js';
import {
  BOARD_COLUMN_DEFS,
  assembleHomeBoard,
  findBoardIssue,
  findBoardPin,
  findBoardPr,
  HOME_BOARD_AGENT_HINT,
  findLiveThreadForCreate,
  type BoardColumnId,
  type BoardKindFilter,
} from '../board/home-board.js';
import type { AgentKind, ThreadAttachment } from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';

const MAX_ORCH_THREADS = 5;
/** Hard ceiling so a stuck create_thread cannot pin the MCP stdio server forever. */
const CREATE_THREAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type ResolveNewThreadOptions = (overrides: {
  agent?: AgentKind;
  model?: string | null;
}) => {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
};

type CreateOrchThreadArgs = {
  sourceType: 'branch' | 'pr' | 'ticket';
  sourceRef: string;
  repoPath: string;
  title?: string;
  agent?: AgentKind;
  model?: string | null;
  cowboy?: boolean;
  parentThreadId?: string;
  attachments?: ThreadAttachment[];
};

async function createOrchChildThread(
  orch: ReturnType<typeof getOrchestrator>,
  args: CreateOrchThreadArgs,
  resolveNewThreadOptions: ResolveNewThreadOptions,
): Promise<
  | { ok: true; text: string }
  | { ok: false; text: string }
> {
  const envParentId = process.env.SIDEBOARD_ORCHESTRATOR_THREAD_ID?.trim() || '';
  let parentId = args.parentThreadId?.trim() || '';
  let parent = parentId ? orch.getThread(parentId) : null;
  let parentCorrectedFrom: string | undefined;

  if (envParentId) {
    const envParent = orch.getThread(envParentId);
    if (envParent) {
      if (parentId && parentId !== envParentId) parentCorrectedFrom = parentId;
      else if (!parentId) parentCorrectedFrom = undefined;
      parentId = envParentId;
      parent = envParent;
    }
  }
  if (parentId && !parent) {
    parentCorrectedFrom = parentId;
    parentId = '';
    parent = null;
  }
  if (parentId) {
    const children = orch
      .getThreads(false)
      .filter((t) => t.parentThreadId === parentId);
    if (children.length >= MAX_ORCH_THREADS) {
      return {
        ok: false,
        text: `Thread-creation cap (${MAX_ORCH_THREADS}) reached for this orchestration session`,
      };
    }
  }
  let agentArg = args.agent;
  let agentCoercedFrom: string | undefined;
  const resolvedProbe = resolveNewThreadOptions({ agent: agentArg }).agent;
  if (resolvedProbe === 'codex') {
    agentCoercedFrom = agentArg ?? 'codex';
    const accountAgent = resolveNewThreadOptions({}).agent;
    agentArg = accountAgent !== 'codex' ? accountAgent : 'cursor';
  }
  const opts = resolveNewThreadOptions({
    agent: agentArg,
    model: args.model,
  });
  try {
    const priorIds = new Set(orch.getThreads(false).map((t) => t.id));
    const thread = await withTimeout(
      orch.createThread({
        sourceType: args.sourceType,
        sourceRef: args.sourceRef,
        agent: opts.agent,
        model: opts.model,
        effort: opts.effort,
        fast: opts.fast,
        repoPath: args.repoPath,
        title: args.title,
        parentThreadId: parentId || null,
        cowboy: args.cowboy || undefined,
        attachments: args.attachments,
      }),
      CREATE_THREAD_TIMEOUT_MS,
      'create_thread',
    );
    const alreadyStarted = priorIds.has(thread.id);
    const parentNote = parentCorrectedFrom
      ? parentId
        ? `Ignored unknown/stale parentThreadId ${parentCorrectedFrom}; nested under ${parentId}`
        : `Ignored unknown/stale parentThreadId ${parentCorrectedFrom}; created without parent`
      : undefined;
    return {
      ok: true,
      text: JSON.stringify({
        id: thread.id,
        title: thread.title,
        branchName: thread.branchName,
        worktreePath: thread.worktreePath,
        agent: thread.agent,
        model: thread.model,
        status: thread.status,
        cowboy: Boolean(thread.cowboy),
        link: `sideboard://thread/${thread.id}`,
        parentThreadId: thread.parentThreadId,
        ...(alreadyStarted ? { alreadyStarted: true } : {}),
        ...(agentCoercedFrom
          ? {
              agentCoercedFrom,
              note: `Avoid nested Codex under a Codex orchestrator — used Account default agent=${thread.agent}`,
            }
          : {}),
        ...(parentCorrectedFrom ? { parentCorrectedFrom, parentNote } : {}),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: `create_thread failed: ${message}` };
  }
}

/**
 * Sideboard MCP server — agent-facing judgment surface.
 * Deliberately excludes ready-for-review confirm_land and purge_thread.
 * Orchestrators commit, push, and open PRs via `ask_git` / `send_to_thread`
 * — they do not run git/gh from the synthetic home. `ask_git` pushes itself when
 * the worktree is already clean. Merge (`ask_git` action=merge) only when the
 * user explicitly asked.
 */
export async function startMcpServer(): Promise<void> {
  const orch = getOrchestrator();
  try {
    await warmGithubAgentAuth();
  } catch (err) {
    console.error(
      '[sideboard-mcp] GitHub agent auth warm skipped:',
      err instanceof Error ? err.message : err,
    );
  }
  // Match desktop concurrency — caps are per-process, but using Account settings
  // avoids MCP defaulting to 3 while desktop runs higher.
  try {
    const { maxConcurrentAgents } = await import('../store/app-settings.js');
    orch.setMaxConcurrent(maxConcurrentAgents());
  } catch {
    // Best-effort — keep constructor default.
  }
  // Do not reclaim "stale running" turns — MCP runs in a separate process from
  // the desktop orchestrator that owns activeTurns. Reclaiming here falsely
  // marks live parent turns as "Process died (reconciled on startup)".
  // Do not drain the whole fleet on every MCP stdio boot (present_* / tool
  // calls): that steals queues into a short-lived process. send_to_thread
  // also skips drain while a desktop host pid is alive — otherwise the
  // worktree Cursor/Claude child runs here with no renderer IPC (blank chat)
  // and desktop Stop/Send now cannot see activeTurns. Desktop adopts
  // persisted queues via the thread-store watcher instead.
  try {
    await orch.reconcile(undefined, { reclaimStaleTurns: false, drainQueues: false });
  } catch (err) {
    console.error(
      '[sideboard-mcp] reconcile on boot failed (continuing):',
      err instanceof Error ? err.message : err,
    );
  }

  const server = new McpServer({
    name: 'sideboard',
    version: '0.1.0',
  });
  // Worktree profile: present_* / ask_user only. Fleet list_*, Slack, Linear,
  // and create/send/wait live on orchestration (tools are the cached prefix).
  const worktreeProfile = sideboardMcpProfile() === 'worktree';

  if (!worktreeProfile) {
  server.tool(
    'list_workspaces',
    'List registered Sideboard workspaces (repos). Each line is name, path, and github:owner/repo when resolvable — use path as repoPath for list_board/list_branches/list_prs/list_issues/create_thread.',
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
    'List Sideboard threads across all workspaces (one summary line each — token-frugal). Includes parent id, last message preview, and live progress so you can see worktree children. Each line ends with sideboard://thread/<id> — use that URL in markdown links so the UI can open the chat.',
    {},
    async () => {
      const threads = orch.getThreads(true);
      const lines = threads.map((t) => {
        const repo =
          t.repoPath === GLOBAL_WORKSPACE_ID
            ? 'Orchestration'
            : basename(t.repoPath) || t.repoPath;
        const live = orch.threadLooksLive(t) ? readTurnLive(t.id) : null;
        const parent = t.parentThreadId ? `  parent:${t.parentThreadId.slice(0, 8)}` : '';
        const preview = lastMessagePreview(t.messages, 80);
        const previewBit = preview ? `  ${preview}` : '';
        const err = t.lastError ? `  error:${t.lastError.replace(/\s+/g, ' ').slice(0, 60)}` : '';
        const progress =
          live?.summary && !isInternalAgentStatusText(live.summary) ? `  ${live.summary}` : '';
        return `${t.id.slice(0, 8)}  ${t.status.padEnd(9)}  ${t.agent.padEnd(8)}  ${repo}  ${t.sourceType}:${t.sourceRef}  ${t.title}${parent}${previewBit}${err}  sideboard://thread/${t.id}${t.devPort ? `  http://localhost:${t.devPort}` : ''}${progress}`;
      });
      return {
        content: [{ type: 'text', text: lines.join('\n') || '(no threads)' }],
      };
    },
  );

  server.tool(
    'list_board',
    'Home Kanban of worktrees (New, Draft, Review, Merged) — one card per checkout; sibling chat tabs nest as inner cards. Same cards as desktop Home. Path to merge: no PR → draft PR → open PR → merged. Archive removes the card to Settings → History. Queued/running are activity on the card, not columns. Orchestration chats are not on the board. Filters: query, repoPath, kind (ticket/PR/branch source), column, limit (default 40). create_thread adds a worktree (and a Home card), or returns the live one if that ticket/PR/named branch is already checked out.',
    {
      query: z.string().optional().describe('Case-insensitive token search across title, id, labels, repo'),
      repoPath: z
        .string()
        .optional()
        .describe('Limit to one workspace path from list_workspaces'),
      kind: z
        .enum(['all', 'tickets', 'prs', 'branches', 'threads'])
        .optional()
        .describe('Filter by worktree source (default all)'),
      column: z
        .enum(['new', 'draft', 'review', 'done', 'needs_you'])
        .optional()
        .describe(
          'Return cards for this column only (totals still include the rest). needs_you is a legacy alias for new.',
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max cards per column (default 40). hidden counts the remainder.'),
    },
    async ({ query, repoPath, kind, column, limit }) => {
      const workspaces = orch.listWorkspaces();
      const all = orch.getThreads(true);
      const names = new Map(workspaces.map((w) => [w.path, w.name]));
      const snap = assembleHomeBoard({
        threads: all.filter((t) => t.status !== 'archived'),
        query,
        repoPath,
        kind: (kind ?? 'all') as BoardKindFilter,
        column: (column === 'needs_you' ? 'new' : column) as BoardColumnId | undefined,
        limit,
        workspaceName: (path) => names.get(path) ?? '',
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                columns: snap.columns,
                hidden: snap.hidden,
                totals: snap.totals,
                columnDefs: BOARD_COLUMN_DEFS,
                hint: HOME_BOARD_AGENT_HINT,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'get_thread',
    'Get a compact thread summary by id/ref. Includes last message preview, parentThreadId, and child worktree threads (status + lastText). While running, includes progress (last tool/thinking) and lastActivityAt. Includes usage (thread billed token + costUsd totals when providers reported cost) and lastTurnUsage.',
    { ref: z.string() },
    async ({ ref }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return { content: [{ type: 'text', text: `Thread not found: ${ref}` }], isError: true };
      }
      const stillRunning = orch.threadLooksLive(t);
      const live = stillRunning ? readTurnLive(t.id) : null;
      const liveSummary =
        live?.summary && !isInternalAgentStatusText(live.summary) ? live.summary : null;
      const spend = orch.getThreadUsage(t.id);
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
        parentThreadId: t.parentThreadId,
        children: childThreadRefs(t.id, orch.getThreads(false)),
        queueLength: t.queue.length,
        messageCount: t.messages.length,
        lastText: lastMessagePreview(t.messages, 240),
        devPort: t.devPort,
        prUrl: t.prUrl,
        lastError: t.lastError ?? null,
        stillRunning,
        progress:
          liveSummary ??
          (stillRunning && t.status === 'queued'
            ? 'Queued — waiting for a concurrency slot'
            : null),
        lastActivityAt: live?.updatedAt ?? null,
        usage: spend.usage,
        lastTurnUsage: spend.lastTurnUsage,
      };
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );
  }

  server.tool(
    'present_artifact',
    'Show a document or live log in Sideboard’s side column. For html/svg/markdown/react, pass the FULL document and do not also fence that same body in chat. For type=log, pass only NEW lines (same artifact_id appends). Prefer type=log for long-running job output — do not resend HTML. type=react is a single default-export component (JSX/TSX); only react/react-dom imports.',
    {
      title: z.string().describe('Short title shown in the artifact pane header'),
      type: z
        .enum(['html', 'svg', 'markdown', 'react', 'log'])
        .describe(
          'html/svg/markdown/react replace the pane. log appends content to the same artifact_id (new lines only).',
        ),
      content: z
        .string()
        .describe(
          'html/svg/markdown/react: full document. log: only the new lines since the last call (empty is ok for a status-only update).',
        ),
      artifact_id: z
        .string()
        .optional()
        .describe('Stable id. Required for type=log so later calls append to the same pane.'),
      status: z
        .enum(['running', 'ok', 'failed', 'idle'])
        .optional()
        .describe('Log header pill: running (working), ok (done), failed, idle'),
      phase: z.string().optional().describe('Log subtitle (Signing, Notarizing, …)'),
      mode: z
        .enum(['append', 'replace'])
        .optional()
        .describe('log only: append (default) or replace the buffer'),
    },
    async ({ title, type, artifact_id, status, phase, mode }) => {
      const id =
        artifact_id?.trim() ||
        `artifact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      // Desktop opens the pane from tool_use input. Do not echo `content` —
      // it would double the document in the model's context.
      const payload = {
        ok: true,
        artifact_id: id,
        title,
        type,
        status,
        phase,
        mode: type === 'log' ? (mode ?? 'append') : undefined,
        message:
          type === 'log'
            ? 'Log accepted. Same artifact_id appends; send only new lines next time.'
            : 'Artifact accepted. Sideboard desktop opens it in the side column beside chat.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    'ask_user',
    'Ask the user a clarifying multiple-choice question in Sideboard’s composer. Call only when work is blocked on choosing among a few concrete options (approach fork, which API, auth vs cookies). Do not call for greetings, check-ins, “hello”, open-ended how-can-I-help, or to invent a menu of possible next tasks — reply in chat instead. If one option is the obvious default, proceed without asking. Before calling, write a short chat message explaining the decision and what each option means. Include a description on every option. After calling, stop and wait for answers. Not for “is the plan ready?”.',
    {
      questions: z
        .array(
          z.object({
            question: z.string().describe('Full question text ending with ?'),
            header: z
              .string()
              .max(24)
              .optional()
              .describe('Short label shown above the question'),
            multiSelect: z
              .boolean()
              .optional()
              .describe('Allow selecting multiple options'),
            options: z
              .array(
                z                .object({
                  label: z.string(),
                  description: z
                    .string()
                    .optional()
                    .describe('What this option means / when to choose it (strongly preferred)'),
                }),
              )
              .min(2)
              .max(6)
              .describe('2–6 choices (Sideboard also offers Other)'),
          }),
        )
        .min(1)
        .max(4)
        .describe('1–4 questions'),
    },
    async ({ questions }) => {
      const payload = {
        ok: true,
        questions,
        message:
          'Questions shown in Sideboard’s composer. Wait for the user’s next message with their answers before continuing.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    'present_plan',
    'Save the implementation plan as markdown to .context/attachments/plan.md and show it in Sideboard chat for user approval (Copy / Hand off / Approve). Call this when the plan is ready — required in plan mode. Pass the full plan body in content. Then Claude should call ExitPlanMode.',
    {
      title: z
        .string()
        .optional()
        .describe('Short plan title (defaults to Plan)'),
      content: z
        .string()
        .min(1)
        .describe('Full plan markdown (headings, steps, risks, open questions)'),
      thread_id: z
        .string()
        .optional()
        .describe('Sideboard thread id when cwd is not the worktree'),
    },
    async ({ title, content, thread_id }) => {
      const { writePlanFile } = await import('../plan/plan-file.js');
      let root = process.cwd();
      if (thread_id?.trim()) {
        const t = orch.getThread(thread_id.trim());
        if (t?.worktreePath?.trim()) root = t.worktreePath;
      }
      const path = writePlanFile(root, content);
      const payload = {
        ok: true,
        path,
        title: title?.trim() || 'Plan',
        message:
          'Plan saved to .context/attachments/plan.md and shown in Sideboard chat for approval.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );

  server.tool(
    'present_schema',
    'Open Sideboard’s schema-driven side column (filterable table and/or form) when the user needs to filter, edit, publish, or persist records. Do not call this just to re-display rows you already wrote as a markdown table. If the user asks for an editable / interactive table, call this even if chat already showed those rows. Pass JSON Schema + optional schemaUi. Prefer datasource=inline with embedded resource/records. Use datasource=brightsy with resource_id only when the user is logged into Brightsy.',
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

  if (!worktreeProfile) {
  registerSlackTools(server);
  registerConnectedIssueVendorTools(server);
  registerScheduleTools(server);
  const { getCaffeinateHold, setCaffeinateHold } = await import(
    '../store/caffeinate-hold.js'
  );
  const { resolveNewThreadOptions, resolveThreadDefaults } = await import(
    '../store/app-settings.js'
  );
  const accountDefaults = resolveThreadDefaults();
  const accountDefaultsHint = `Account defaults: agent=${accountDefaults.agent}, model=${accountDefaults.model?.trim() || 'Auto'}, effort=${accountDefaults.effort}`;

  server.tool(
    'set_caffeinate',
    'Keep this Mac awake with caffeinate (like Claude Code) across turns — independent of Settings toggles. Turn ON when the user will be away from the keyboard, is driving work from Slack, or asks you to keep the machine awake. Turn OFF when they say they are done, wrapping up, going to sleep, or no longer need the Mac awake. Closing or archiving this orchestration chat also releases the hold. macOS only.',
    {
      enabled: z
        .boolean()
        .describe('true = hold caffeinate on; false = release and let the Mac sleep'),
    },
    async ({ enabled }) => {
      const threadId = process.env.SIDEBOARD_ORCHESTRATOR_THREAD_ID?.trim() || null;
      const state = setCaffeinateHold(enabled, { threadId });
      if (enabled && !state.held) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...state,
                ok: false,
                message:
                  state.platform === 'darwin'
                    ? 'Could not start caffeinate.'
                    : 'Caffeinate is macOS only.',
              }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...getCaffeinateHold(),
              ok: true,
              message: state.held
                ? 'Mac will stay awake until you call set_caffeinate with enabled=false, the user says they are done, or this orchestration chat is closed.'
                : 'Caffeinate hold released. The Mac can sleep (unless Settings caffeinate toggles are on).',
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'create_thread',
    `Create a worktree thread (chat) from branch, pr, or ticket. A ticket, PR, or named branch may have only one live worktree — if one already matches, returns it (alreadyStarted=true) instead of a second checkout. Creating from the default branch still opens a new isolated worktree. Pass repoPath from list_workspaces. cowboy=true uses the project folder on the default branch (no isolated worktree; land is commit+push). From an orchestration chat, omit parentThreadId (Sideboard binds the child to this chat) or pass the exact id from the turn reminder — never invent a uuid. Prefer omitting agent/model so Sideboard applies ${accountDefaultsHint}. Setup (settings.toml, .cursor/worktrees.json, or script/setup) runs in the background in parallel with the first turn (skipped for cowboy). Then use send_to_thread to chat.`,
    {
      sourceType: z.enum(['branch', 'pr', 'ticket']),
      sourceRef: z.string(),
      agent: z
        .enum(['claude', 'codex', 'opencode', 'brightsy', 'cursor'])
        .optional()
        .describe(`Omit to use Account default agent (${accountDefaults.agent})`),
      model: z
        .string()
        .nullable()
        .optional()
        .describe(
          `Usually omit to use Account default model (${accountDefaults.model?.trim() || 'Auto'}). Pass null only to force Auto / agent-default.`,
        ),
      repoPath: z.string(),
      title: z.string().optional(),
      cowboy: z
        .boolean()
        .optional()
        .describe(
          'If true, work in the project folder on the default branch (no thread/* worktree). Requires Settings → Advanced → Cowboy mode. Land is commit+push to that branch. Archive does not delete the folder.',
        ),
      parentThreadId: z
        .string()
        .optional()
        .describe(
          'Orchestration: omit (preferred) or pass YOUR chat id from the turn reminder / AGENTS.md. Do not invent uuids.',
        ),
    },
    async (args) => {
      const result = await createOrchChildThread(orch, args, resolveNewThreadOptions);
      return {
        content: [{ type: 'text', text: result.text }],
        ...(result.ok ? {} : { isError: true }),
      };
    },
  );

  server.tool(
    'start_board_card',
    'Same as create_thread for a ticket, PR, or named branch (attaches issue text when Sideboard can resolve it). Does not create a second worktree when one already matches — returns that thread (alreadyStarted). Then send_to_thread.',
    {
      kind: z.enum(['ticket', 'pr', 'branch']),
      ref: z
        .string()
        .describe('Ticket identifier (ENG-12), PR number (44), or branch name from list_board'),
      repoPath: z.string().describe('Workspace path from list_workspaces / list_board'),
      title: z.string().optional(),
    },
    async ({ kind, ref, repoPath, title }) => {
      const root = await resolveRepoRoot(repoPath);
      const existing = findLiveThreadForCreate(
        {
          sourceType: kind,
          sourceRef: ref.trim(),
          repoPath: canonicalizeRepoPath(root),
          title: title?.trim(),
        },
        orch.getThreads(false).map((t) => ({
          ...t,
          repoPath: canonicalizeRepoPath(t.repoPath),
        })),
      );
      if (existing) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                alreadyStarted: true,
                id: existing.id,
                title: existing.title,
                status: existing.status,
                link: `sideboard://thread/${existing.id}`,
              }),
            },
          ],
        };
      }

      const workspaces = orch.listWorkspaces();
      const loaded = await getHomeBoardInputs(workspaces);
      const pin = findBoardPin(loaded.pins, kind, ref, root);

      if (kind === 'branch') {
        const sourceRef = pin?.ref === 'default' ? 'default' : (pin?.ref ?? ref.trim());
        const result = await createOrchChildThread(
          orch,
          {
            sourceType: 'branch',
            sourceRef,
            repoPath: root,
            title: title?.trim() || pin?.title || (sourceRef === 'default' ? undefined : sourceRef),
          },
          resolveNewThreadOptions,
        );
        return {
          content: [{ type: 'text', text: result.text }],
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (kind === 'ticket') {
        const issue = findBoardIssue(loaded.issues, ref, root);
        const ident = issue?.identifier ?? ref.trim();
        const attachments: ThreadAttachment[] | undefined = issue
          ? [
              {
                id: randomUUID(),
                name: issue.identifier,
                kind: 'issue',
                content: [
                  `Linked issue: ${issue.identifier} — ${issue.title}`,
                  issue.url ? `URL: ${issue.url}` : null,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ]
          : undefined;
        const result = await createOrchChildThread(
          orch,
          {
            sourceType: 'ticket',
            sourceRef: ident,
            repoPath: root,
            title: title?.trim() || issue?.title,
            attachments,
          },
          resolveNewThreadOptions,
        );
        return {
          content: [{ type: 'text', text: result.text }],
          ...(result.ok ? {} : { isError: true }),
        };
      }

      const pr = findBoardPr(loaded.prs, ref, root);
      const number = pr ? String(pr.number) : ref.trim().replace(/^#/, '');
      const result = await createOrchChildThread(
        orch,
        {
          sourceType: 'pr',
          sourceRef: number,
          repoPath: root,
          title: title?.trim() || pr?.title,
        },
        resolveNewThreadOptions,
      );
      return {
        content: [{ type: 'text', text: result.text }],
        ...(result.ok ? {} : { isError: true }),
      };
    },
  );

  server.tool(
    'send_to_thread',
    'Queue a prompt on a worktree thread chat (runs under concurrency cap). Use after create_thread to start or continue a conversation. For commit/push/PR, prefer ask_git (canonical desktop-button phrases). Send "Merge PR." / ask_git merge only when the user explicitly asked to merge. force_stop=true kills the in-flight turn and clears the queue before this prompt — only when the current request is wrong and must be replaced. Do not force_stop to check in, resume after a halt notice, or because wait_for_turn returned stillRunning; that stops the child mid-thought. Call wait_for_turn again instead.',
    {
      ref: z.string(),
      prompt: z.string(),
      force_stop: z.boolean().optional(),
    },
    async ({ ref, prompt, force_stop }) => {
      if (force_stop) {
        const existing = orch.getThread(ref);
        if (existing) {
          orch.stop(ref, { clearQueue: true, notifyParent: false });
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
    'Wait until the thread finishes its current/queued turn, or return early with a live progress snapshot. MCP clients often kill tools around 60s, so this returns within 45s even while the child is still working. stillRunning is the source of truth — if false, the child is not working (do not say it is waiting for a gate). If stillRunning is true, progress is tools/thinking (or “queued, waiting for a concurrency slot” if it has not started). Call wait_for_turn again. Do not send a check-in prompt, force_stop, or assume a hang. On status error, lastError/text is the failure. On status stopped or broken, the child did not finish — resume with send_to_thread or tell the user; do not treat that as success. When finished, usage is the last agent turn’s tokens + costUsd (when the provider reported cost).',
    {
      ref: z.string(),
      timeoutMs: z.number().optional(),
    },
    async ({ ref, timeoutMs }) => {
      const thread = await orch.waitForTurn(ref, mcpWaitForTurnTimeoutMs(timeoutMs), {
        resolveIfStillRunning: true,
      });
      const result = orch.getTurnResult(thread.id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: thread.id,
              status: result.status,
              text: result.text,
              lastError: result.lastError,
              stillRunning: result.stillRunning,
              progress: result.progress,
              lastActivityAt: result.lastActivityAt,
              hint: result.stillRunning
                ? mcpWaitStillRunningHint(result.status)
                : mcpWaitFinishedHint(result.status),
              incomplete: !result.stillRunning && Boolean(mcpWaitFinishedHint(result.status)),
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'get_turn_result',
    'Assistant message when the turn finished, or live progress while stillRunning. Not the full transcript. Includes usage for the last agent turn (tokens + costUsd when reported).',
    { ref: z.string() },
    async ({ ref }) => {
      const result = orch.getTurnResult(ref);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...result,
              hint: result.stillRunning
                ? mcpWaitStillRunningHint(result.status)
                : mcpWaitFinishedHint(result.status),
              incomplete: !result.stillRunning && Boolean(mcpWaitFinishedHint(result.status)),
            }),
          },
        ],
      };
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
      const stopped = orch.stop(ref, { clearQueue, notifyParent: false });
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
    'Archive a thread (stops agent/dev, runs archive script, removes worktree when last chat tab). Coordinators commit, push, and open PRs by asking the worktree agent (ask_git). Merge only when the user explicitly asked.',
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
    'get_pr_checks',
    'Snapshot of GitHub PR checks for a worktree thread (`gh pr checks` plus merge/review gates). null = no PR. If the user gave a goal (Greptile 5/5, CI green), the worktree agent watches with `gh pr checks --watch` via /long-running — this tool is a snapshot, not a waiter. Coordinators: do not run gh from the orchestration cwd.',
    { ref: z.string().describe('Worktree thread id/ref') },
    async ({ ref }) => {
      try {
        const checks = await orch.getPrChecks(ref);
        return {
          content: [{ type: 'text', text: JSON.stringify(checks) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'request_review',
    'Start a merge-readiness Review on a worktree agent thread (same as the desktop Review button). Opens a new Review chat tab, attaches .claude/skills/review/SKILL.md when present (else copies .sideboard/review.md into .context/review.md, or seeds that file from the stock template), and sends "Review changes in this workspace." Expect Approve / Approve with nits / Request changes / Needs more information. Pass a worktree thread ref — not the orchestrator. Then wait_for_turn (loop while stillRunning) / get_turn_result on the returned review tab id.',
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

  server.tool(
    'ask_git',
    'Commit & push, open a draft PR, resolve conflicts, or merge — same actions as the desktop git buttons. When the worktree is clean, Sideboard pushes / opens the PR itself (HTTPS via `gh` even when origin is SSH / Settings → Git is SSH). When dirty, queues the worktree agent to commit; then wait_for_turn (loop while stillRunning). Do not start a checks loop on a plain push — only if the user gave a goal (Greptile 5/5, CI green). Pass a worktree thread ref (not the orchestrator). action=merge only when the user explicitly asked to merge that PR. Do not run git or gh from the orchestration cwd. If this tool errors that the GraphQL/PR body is too long, the branch is already pushed — have the worktree agent retry `gh pr create --body-file` with a short description (GitHub limit 65,536 characters). Do not invent SSH/auth failures from that error.',
    {
      ref: z.string().describe('Worktree thread id/ref'),
      action: z
        .enum(AGENT_GIT_ACTIONS)
        .describe(
          'commit-push | create-draft | create-web | resolve-conflicts | merge',
        ),
    },
    async ({ ref, action }) => {
      try {
        const thread = await orch.askGit(ref, action);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: thread.id,
                status: thread.status,
                queueLength: thread.queue.length,
                action,
                link: `sideboard://thread/${thread.id}`,
              }),
            },
          ],
        };
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = formatGhLandError(raw);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: true,
                  action,
                  lastError: message,
                  hint: /body is too long/i.test(message)
                    ? 'Branch is already pushed. send_to_thread so the worktree agent runs gh pr create --draft -R <origin> --body-file <short.md>. Keep the description short.'
                    : undefined,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
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
    'Fork a worktree agent chat into a NEW git worktree + chat (desktop “Fork to new workspace”). Seeds a transcript (through through_index, default all). Optional agent override. Leave model unset for Auto (default) — only pass model when you have a reason. Not for the orchestrator. Then send_to_thread / wait_for_turn (loop while stillRunning) on the returned id.',
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
        if (source) await orch.reconcile(source.repoPath, { drainQueues: false });
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
    'Fork a chat into a NEW tab on the SAME workspace: worktree agent → same worktree tab; Global orchestration chat → new orchestration chat (same synthetic home). Seeds a transcript; optional agent override. Leave model unset for Auto unless you have a reason. Orchestration forks require an MCP-capable agent (claude, cursor, codex, opencode — not brightsy). Slack / Global orchestrators use this to continue an orchestration chat on another agent after session limits. Then send_to_thread / wait_for_turn (loop while stillRunning) on the returned id. Use fork_worktree only for worktree agents that need a new git worktree.',
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
    'Re-run workspace setup (Sideboard/Conductor settings, .cursor/worktrees.json, or script/setup). New worktrees already run this automatically.',
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
    'List GitHub PRs for a registered workspace (the review surface for assigned ticket work — not the tickets). Pass repoPath from list_workspaces. "Get me N tickets to review" → queue=review and limit=N: open non-draft PRs labeled eng-review with no individual user reviewer. A team like engineering-team is not a claim (you are on that team). Also: state (open|closed|merged|all|review), label, reviewer (me|unassigned|login), query, limit (default 40, max 250). Then create_thread with sourceType=pr.',
    {
      repoPath: z.string(),
      query: z.string().optional().describe('GitHub search tokens (title, draft:true, …)'),
      queue: z
        .enum(['review', 'mine', 'approved', 'changes'])
        .optional()
        .describe(
          'review = unclaimed eng-review inbox (use for "get me N tickets to review"). mine = review-requested:@me. approved / changes = eng-approved / eng-requested-changes.',
        ),
      state: z
        .enum(['open', 'closed', 'merged', 'all', 'review'])
        .optional()
        .describe('GitHub PR state (default open). review is an alias for queue=review.'),
      label: z
        .string()
        .optional()
        .describe(
          'GitHub label / workflow tag. Comma-separated AND. Examples: eng-review, eng-approved, eng-requested-changes',
        ),
      reviewer: z
        .string()
        .optional()
        .describe(
          'me (review requested of you), unassigned (no individual reviewer; team queues like engineering-team still count), all, or a GitHub login',
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(250)
        .optional()
        .describe('Page size (default 40, max 250). Raise when truncated is true.'),
    },
    async ({ repoPath, query, queue, state, label, reviewer, limit }) => {
      const root = await resolveRepoRoot(repoPath);
      const page = clampMcpIssueLimit(limit);
      const resolved = resolveListPrsOptions({
        query,
        queue,
        state,
        labels: label,
        reviewer,
        limit: page + 1,
      });
      const prs = await listPrs(root, resolved);
      const windowed = applyIssueListWindow(prs, page);
      return mcpJson(
        formatMcpPrList({
          queue: resolved.queue,
          state: resolved.state,
          labels: resolved.labels,
          reviewer: resolved.reviewer,
          query: resolved.query,
          limit: page,
          prs: windowed.items,
          truncated: windowed.truncated,
        }),
      );
    },
  );

  server.tool(
    'get_pr_stack',
    'Load the GitHub PR stack for a thread worktree (`gh stack view --json`). Returns null JSON when the branch is not stacked. Prefer this before ask_git merge on stacked PRs (and only merge when the user explicitly asked).',
    { ref: z.string() },
    async ({ ref }) => {
      const stack = await orch.getPrStack(ref);
      return {
        content: [{ type: 'text', text: JSON.stringify(stack, null, 2) }],
      };
    },
  );

  server.tool(
    'open_pr_stack_layers',
    'Materialize one worktree+thread per stack layer (or a single 1-based layer). Pass a thread ref already on the stack.',
    {
      ref: z.string(),
      layer: z.number().int().positive().optional(),
    },
    async ({ ref, layer }) => {
      const result = await orch.openPrStackLayers(ref, { layer });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                stackNumber: result.stack.stackNumber,
                trunk: result.stack.trunk,
                threads: result.threads.map((t) => ({
                  id: t.id,
                  title: t.title,
                  branchName: t.branchName,
                  stackLayer: t.stackLayer,
                  worktreePath: t.worktreePath,
                  prUrl: t.prUrl,
                  link: `sideboard://thread/${t.id}`,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'add_stack_layer',
    'Add a branch on top of the current stack (`gh stack add`) and open a worktree+thread for it.',
    {
      ref: z.string(),
      branchName: z.string(),
      title: z.string().optional(),
    },
    async ({ ref, branchName, title }) => {
      const result = await orch.addStackLayer(ref, branchName, { title });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: result.thread.id,
                title: result.thread.title,
                branchName: result.thread.branchName,
                stackLayer: result.thread.stackLayer,
                worktreePath: result.thread.worktreePath,
                link: `sideboard://thread/${result.thread.id}`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'create_pr_stack',
    'Create a new GitHub PR stack with one Sideboard worktree per layer (bottom→top branch names). Requires `gh extension install github/gh-stack`.',
    {
      repoPath: z.string(),
      branches: z.array(z.string()).min(1),
      agent: z.enum(['claude', 'codex', 'opencode', 'brightsy', 'cursor']),
      base: z.string().optional(),
      title: z.string().optional(),
    },
    async (args) => {
      const result = await orch.createPrStack({
        repoPath: args.repoPath,
        branches: args.branches,
        agent: args.agent,
        base: args.base,
        title: args.title,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                stackNumber: result.stack.stackNumber,
                trunk: result.stack.trunk,
                threads: result.threads.map((t) => ({
                  id: t.id,
                  title: t.title,
                  branchName: t.branchName,
                  stackLayer: t.stackLayer,
                  worktreePath: t.worktreePath,
                  link: `sideboard://thread/${t.id}`,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'list_issues',
    'List or search issues (Linear, AbleTime, or GitHub; falls back to GitHub). Default 40; pass query and/or limit (max 250) when truncated. assignee: me (Linear default), unassigned, all, or a user id. Then create_thread with sourceType=ticket.',
    {
      repoPath: z.string(),
      query: z.string().optional().describe('Search title, identifier, or description'),
      assignee: z
        .string()
        .optional()
        .describe('me (Linear default), unassigned, all, a user id, or a GitHub login'),
      limit: z
        .number()
        .int()
        .positive()
        .max(250)
        .optional()
        .describe('Page size (default 40, max 250). Raise when truncated is true.'),
    },
    async ({ repoPath, query, assignee, limit }) => {
      const root = await resolveRepoRoot(repoPath);
      const page = clampMcpIssueLimit(limit);
      const result = await listIssues(root, { query, assignee, limit: page + 1 });
      const windowed = applyIssueListWindow(result.issues, page);
      return mcpJson(
        formatMcpIssueList({
          source: result.source,
          viewer: result.viewer?.name || result.viewer?.login,
          limit: page,
          issues: windowed.items,
          truncated: windowed.truncated,
        }),
      );
    },
  );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
