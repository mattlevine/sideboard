import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClippedMcpServer } from './wrap-mcp-tools.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { getOrchestrator, resolveOrchChildFollowUp } from '../orchestrator/orchestrator.js';
import { needsCoordinatorAction } from '../orchestrator/task-state.js';
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
import { sideboardMcpProfile, SIDEBOARD_THREAD_ID_ENV, shouldRegisterMcpWaitForTurn, worktreeMcpToolNames } from './profile.js';
import {
  PRESENT_PLAN_REQUIRES_PLAN_MODE,
  PRESENT_PLAN_TOOL_DESCRIPTION,
  shouldRegisterPresentPlan,
  threadMayPresentPlan,
} from '../plan/plan-present.js';
import { resolveRunScriptThreadRef } from './run-script-ref.js';
import { workspaceAgentChatSummaries } from '../threads/chat-tabs.js';
import { applyWorkspaceTags, workspaceTagTargetRef } from '../threads/workspace-tags.js';
import { createOrchChildThread } from './create-orch-child.js';
import { agentBlockFields, chatBlockedSuffix, stampAskUserBlock, stampNotifyBlock, stampPlanBlock } from '../orchestrator/agent-block.js';
import { notifyOrchestrator, resolveNotifyCallerThread } from '../orchestrator/notify-orchestrator.js';
import {
  activeRunPreview,
  runScriptPreview,
  type DevPreview,
} from '../hook/dev-preview.js';
import { localhostPreviewUrl } from '../agents/instructions.js';
import {
  DEFAULT_RUN_LOG_TAIL_CHARS,
  MAX_RUN_LOG_CHARS,
  sliceRunLogOutput,
} from '../store/run-log.js';
import {
  mcpWaitTaskHint,
  mcpWaitForTurnTimeoutMs,
  waitForTurnToolResult,
} from './wait-for-turn.js';
import {
  mcpWaitForJobTimeoutMs,
  stopDetachedJob,
  waitForDetachedJob,
} from './wait-for-job.js';
import { isInternalAgentStatusText } from '../agents/message-parts.js';
import { readTurnLive } from '../store/turn-live.js';
import { childThreadRefs, lastMessagePreview } from './thread-visibility.js';
import { registerConnectedIssueVendorTools } from './issue-vendor-tools.js';
import { registerViewerContextTools } from './viewer-context-tools.js';
import {
  applyIssueListWindow,
  clampMcpIssueLimit,
  formatListedIssuesForMcp,
  mcpIssueUpdatedSinceSchema,
  mcpJson,
} from './issue-list.js';
import { formatMcpPrList } from './pr-list.js';
import { resolveListPrsOptions } from '../git/list-prs.js';
import {
  formatWorkspaceProfileSuffix,
  loadAppSettings,
  resolveProjectReviewLabel,
  resolveViewerProfile,
  resolveViewerProfileForRepo,
} from '../store/app-settings.js';
import { registerScheduleTools } from './schedule-tools.js';
import { presentArtifactResult } from '../agent-rpc/handlers.js';
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
  type BoardOwnershipFilter,
} from '../board/home-board.js';
import { getGitHubStatus } from '../integrations/github.js';
import type { ThreadAttachment } from '../types/thread.js';

function previewHint(preview: DevPreview): string {
  return preview === 'window'
    ? 'Electron: the native window is the app. url is the renderer/HMR origin only — do not open it in a browser (no preload/IPC).'
    : 'Open url in a browser, curl, or Playwright to use the app.';
}

/**
 * Sideboard MCP server — agent-facing judgment surface.
 * Deliberately excludes ready-for-review confirm_land and purge_chat.
 * Orchestrators commit, push, and open PRs via `ask_git` / `send_to_chat`
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
  // calls): that steals queues into a short-lived process. send_to_chat
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

  const server = createClippedMcpServer();
  // Worktree profile: present_* / ask_user / wait_for_job / stop_job /
  // list_run_scripts / run_dev_script / stop_dev_script / get_run_log /
  // notify_orchestrator / viewer context + Account issue tools
  // (GitHub / Linear / AbleTime) + local schedules. Fleet list_*, Slack,
  // and create/send stay on orchestration (tools are the cached prefix).
  const worktreeProfile = sideboardMcpProfile() === 'worktree';
  const notifyParent = async (input: {
    reason: 'input-required' | 'blocked';
    message: string;
  }): Promise<void> => {
    if (!worktreeProfile) return;
    try {
      const child = resolveNotifyCallerThread();
      await notifyOrchestrator({
        child,
        reason: input.reason,
        message: input.message,
        send: (id, prompt, opts) => orch.send(id, prompt, opts),
      });
    } catch {
      /* no parent, missing thread, tests */
    }
  };
  registerViewerContextTools(server);
  if (worktreeProfile) {
    registerConnectedIssueVendorTools(server);
  }

  if (!worktreeProfile) {
  server.tool(
    'list_projects',
    'List registered projects (git repos). Each line is name, path, github:owner/repo when resolvable, and project context when set — use path as repoPath for list_board/list_branches/list_prs/list_issues/create_workspace. Account / project context (Settings → Agents / Projects) says which tickets and review PRs belong to the user.',
    {},
    async () => {
      const workspaces = orch.listWorkspaces();
      const lines = await Promise.all(
        workspaces.map(async (w) => {
          const slug = await resolveGithubRepoSlug(w.path).catch(() => null);
          let profile;
          try {
            profile = resolveViewerProfileForRepo(w.path);
          } catch {
            profile = resolveViewerProfile();
          }
          const suffix = formatWorkspaceProfileSuffix(profile);
          return slug
            ? `${w.name}  ${w.path}  github:${slug}${suffix}`
            : `${w.name}  ${w.path}${suffix}`;
        }),
      );
      return {
        content: [
          { type: 'text', text: lines.join('\n') || '(no projects)' },
        ],
      };
    },
  );

  server.tool(
    'list_chats',
    'List chats across all projects (one summary line each — token-frugal). Includes parent id, last message preview, blocked: when an agent is waiting on a person, and live progress so you can see workspace children. Each line ends with sideboard://chat/<id> — use that URL in markdown links so the UI can open the chat.',
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
        return `${t.id.slice(0, 8)}  ${t.status.padEnd(9)}  ${t.agent.padEnd(8)}  ${repo}  ${t.sourceType}:${t.sourceRef}  ${t.title}${parent}${previewBit}${chatBlockedSuffix(t)}${err}  sideboard://chat/${t.id}${t.devPort ? `  http://localhost:${t.devPort}` : ''}${progress}`;
      });
      return {
        content: [{ type: 'text', text: lines.join('\n') || '(no chats)' }],
      };
    },
  );

  server.tool(
    'list_board',
    'Home Kanban of workspaces (New, Draft, Review, Merged) — one card per checkout; sibling chats on that card are separate agents. Same cards as desktop Home. Path to merge: no PR → draft PR → open PR → merged. Archive removes the card to Settings → History. Queued/running are activity on the card, not columns. Orchestration chats are not on the board. Filters: query, repoPath, kind (ticket/PR/branch source), ownership (mine = your PRs / WIP; reviewing = someone else\'s PR), column, limit (default 40). create_workspace adds a workspace (and a Home card), or returns the live checkout if that ticket/PR/named branch is already checked out. That reuse is one checkout, not one agent — fork_chat to add another.',
    {
      query: z
        .string()
        .optional()
        .describe('Case-insensitive token search across title, id, labels, workspace tags, repo'),
      repoPath: z
        .string()
        .optional()
        .describe('Limit to one project path from list_projects'),
      kind: z
        .enum(['all', 'tickets', 'prs', 'branches', 'threads'])
        .optional()
        .describe('Filter by worktree source (default all)'),
      ownership: z
        .enum(['all', 'mine', 'reviewing'])
        .optional()
        .describe(
          'Mine = PRs you authored or local WIP; reviewing = someone else\'s PR. Uses the gh login.',
        ),
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
    async ({ query, repoPath, kind, ownership, column, limit }) => {
      const workspaces = orch.listWorkspaces();
      const all = orch.getThreads(true);
      const names = new Map(workspaces.map((w) => [w.path, w.name]));
      const github = await getGitHubStatus();
      const snap = assembleHomeBoard({
        threads: all.filter((t) => t.status !== 'archived'),
        query,
        repoPath,
        kind: (kind ?? 'all') as BoardKindFilter,
        ownership: (ownership ?? 'all') as BoardOwnershipFilter,
        viewerLogin: github.login ?? '',
        column: (column === 'needs_you' ? 'new' : column) as BoardColumnId | undefined,
        limit,
        workspaceName: (path) => names.get(path) ?? '',
      });
      return mcpJson({
        columns: snap.columns,
        hidden: snap.hidden,
        totals: snap.totals,
        columnDefs: BOARD_COLUMN_DEFS,
        hint: HOME_BOARD_AGENT_HINT,
      });
    },
  );

  server.tool(
    'get_chat',
    'Get a compact chat summary by id/ref. Includes last message preview, parentChatId, and child workspace chats (status + lastText). While running, includes progress (last tool/thinking) and lastActivityAt. Includes usage (billed token + costUsd totals when providers reported cost) and lastTurnUsage. blockedReason is why that agent is waiting on a person (question, plan approval, or a reported block).',
    { ref: z.string() },
    async ({ ref }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return { content: [{ type: 'text', text: `Chat not found: ${ref}` }], isError: true };
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
        parentChatId: t.parentThreadId,
        parentThreadId: t.parentThreadId,
        tags: t.tags ?? [],
        children: childThreadRefs(t.id, orch.getThreads(false)),
        queueLength: t.queue.length,
        messageCount: t.messages.length,
        lastText: lastMessagePreview(t.messages, 240),
        devPort: t.devPort,
        prUrl: t.prUrl,
        lastError: t.lastError ?? null,
        ...agentBlockFields(t),
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
      return mcpJson(summary);
    },
  );
  }

  const mcpCatalog = new Set(worktreeMcpToolNames());
  if (mcpCatalog.has('present_artifact')) {
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
        // Desktop opens the pane from tool_use input. Do not echo `content` —
        // it would double the document in the model's context.
        return mcpJson(
          presentArtifactResult({ title, type, artifact_id, status, phase, mode }),
        );
      },
    );
  }

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
      await notifyParent({
        reason: 'input-required',
        message: stampAskUserBlock(resolveNotifyCallerThread, questions),
      });
      return mcpJson(payload);
    },
  );

  const callingThreadId = process.env[SIDEBOARD_THREAD_ID_ENV]?.trim() || '';
  const callingThread = callingThreadId ? orch.getThread(callingThreadId) : null;
  if (shouldRegisterPresentPlan(callingThread)) {
    server.tool(
      'present_plan',
      PRESENT_PLAN_TOOL_DESCRIPTION,
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
        const ref = thread_id?.trim() || callingThreadId;
        const t = ref ? orch.getThread(ref) : null;
        if (t && !threadMayPresentPlan(t)) {
          return mcpJson(
            { ok: false, error: PRESENT_PLAN_REQUIRES_PLAN_MODE },
            true,
          );
        }
        let root = process.cwd();
        if (t?.worktreePath?.trim()) root = t.worktreePath;
        const path = writePlanFile(root, content);
        const payload = {
          ok: true,
          path,
          title: stampPlanBlock(t?.id, title),
          message:
            'Plan saved to .context/attachments/plan.md and shown in Sideboard chat for approval.',
        };
        return mcpJson(payload);
      },
    );
  }

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
      return mcpJson(payload);
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
      return mcpJson(payload);
    },
  );

  if (mcpCatalog.has('wait_for_job')) {
    server.tool(
      'wait_for_job',
      'Wait on a detached long job (tests, pack, deploy, connector CLI) started with detached-job.cjs. MCP clients kill tools around 60s, so this returns within 45s. Sideboard opens a type=log pane from this result (artifact_id = job id, content = delta). stillRunning is the source of truth — if true, call wait_for_job again. If the job is hanging, producing no useful output, or doing the wrong thing, call stop_job instead of looping forever. Do not end the turn or tell the user you will let them know later. If false, ok/failed is the result.',
      {
        id: z
          .string()
          .describe('Detached job id (same kebab-case id passed to detached-job.cjs start)'),
        timeoutMs: z.number().optional(),
      },
      async ({ id, timeoutMs }) => {
        const result = await waitForDetachedJob(process.cwd(), id, {
          timeoutMs: mcpWaitForJobTimeoutMs(timeoutMs),
        });
        return mcpJson(result);
      },
    );

    server.tool(
      'stop_job',
      'Stop a detached job you started with detached-job.cjs when it is hanging, producing no useful output, buffering forever, or doing the wrong thing (wrong project, infinite watch, huge dump). Do not stop a pack/test/deploy that is clearly making progress. The type=log pane updates to status=failed with the last delta. Then decide the next step.',
      {
        id: z
          .string()
          .describe('Detached job id (same kebab-case id passed to detached-job.cjs start)'),
        reason: z
          .string()
          .optional()
          .describe('Why you are stopping (hanging, no progress, wrong output, already have the answer)'),
      },
      async ({ id, reason }) => {
        const result = await stopDetachedJob(process.cwd(), id, { reason });
        return mcpJson(result);
      },
    );
  }

  server.tool(
    'list_run_scripts',
    'List .sideboard/.conductor run scripts for this thread (same menu as the desktop Dev button) and which are active. Each script and active run includes preview: url (open http://localhost:<SIDEBOARD_PORT>) or window (Electron: native window is the app; url is renderer/HMR only). Never guess :3000. Worktree turns may omit ref (uses cwd).',
    {
      ref: z
        .string()
        .optional()
        .describe('Thread id. Omit on a worktree turn (uses cwd).'),
    },
    async ({ ref }) => {
      try {
        const threadRef = resolveRunScriptThreadRef(ref);
        const worktreePath = orch.getThread(threadRef)?.worktreePath ?? '';
        const scripts = orch.listThreadRunScripts(threadRef).map((script) => ({
          ...script,
          preview: runScriptPreview(script, worktreePath),
        }));
        const active = orch.getActiveRuns(threadRef).map((run) => {
          const preview = activeRunPreview(run.scriptName, scripts, worktreePath);
          return {
            ...run,
            url: localhostPreviewUrl(run.port),
            preview,
            hint: previewHint(preview),
          };
        });
        return mcpJson({ scripts, active, ref: threadRef });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'run_dev_script',
    'Start a .sideboard/.conductor run script (same as the desktop Dev / play button). Several named scripts can run at once; each gets its own port, and starting one does not stop the others. Logs and Stop appear in the thread UI — do not detached-job or shell-spawn the same command. Returns {port, ports, url, preview}. preview=url → open url (browser, curl, Playwright). preview=window → Electron: the native window is the app; url is renderer/HMR only (no preload/IPC in a browser). The port is allocated SIDEBOARD_PORT, not 3000. Worktree turns may omit ref (uses cwd). Omit name for the default script.',
    {
      ref: z
        .string()
        .optional()
        .describe('Thread id. Omit on a worktree turn (uses cwd).'),
      name: z
        .string()
        .optional()
        .describe('Script name from list_run_scripts (default script if omitted).'),
    },
    async ({ ref, name }) => {
      try {
        const threadRef = resolveRunScriptThreadRef(ref);
        const result = await orch.startDev(threadRef, name);
        const worktreePath = orch.getThread(threadRef)?.worktreePath ?? '';
        const scripts = orch.listThreadRunScripts(threadRef);
        const preview = activeRunPreview(result.scriptName, scripts, worktreePath);
        return mcpJson({
          port: result.port,
          scriptName: result.scriptName,
          ports: result.ports,
          url: localhostPreviewUrl(result.port),
          preview,
          hint: previewHint(preview),
          ref: threadRef,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'stop_dev_script',
    'Stop a run script started with run_dev_script or the desktop Dev button (same as UI Stop). Omit name to stop all scripts on this worktree. Worktree turns may omit ref (uses cwd).',
    {
      ref: z
        .string()
        .optional()
        .describe('Thread id. Omit on a worktree turn (uses cwd).'),
      name: z
        .string()
        .optional()
        .describe('Script name to stop; omit to stop all active scripts.'),
    },
    async ({ ref, name }) => {
      try {
        const threadRef = resolveRunScriptThreadRef(ref);
        await orch.stopDev(threadRef, name);
        return mcpJson({ ok: true, ref: threadRef, stopped: name ?? 'all' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'get_run_log',
    'Read the Run-tab terminal for a worktree script (same stdout/stderr as the desktop Dev pane). Default is a tail — raise `tail` only if the error is missing. Worktree turns may omit ref (uses cwd). Omit name for the default script.',
    {
      ref: z
        .string()
        .optional()
        .describe('Thread id. Omit on a worktree turn (uses cwd).'),
      name: z
        .string()
        .optional()
        .describe('Script name from list_run_scripts (default script if omitted).'),
      tail: z
        .number()
        .int()
        .min(1)
        .max(MAX_RUN_LOG_CHARS)
        .optional()
        .describe(
          `Max characters to return from the end (default ${DEFAULT_RUN_LOG_TAIL_CHARS}). Do not request the full buffer unless the tail is truncated and you still need more.`,
        ),
    },
    async ({ ref, name, tail }) => {
      try {
        const threadRef = resolveRunScriptThreadRef(ref);
        const snap = orch.getRunLog(threadRef, name);
        const sliced = sliceRunLogOutput(snap.output, tail ?? DEFAULT_RUN_LOG_TAIL_CHARS);
        let hint: string | undefined;
        if (!sliced.output && snap.running) {
          hint =
            'Script is running but this Sideboard has no captured lines yet (started before run-log persistence, or it has not printed). New output will appear here.';
        } else if (!sliced.output) {
          hint =
            'No captured output. Start the script with run_dev_script, or it exited without printing.';
        } else if (sliced.truncated) {
          hint = `Truncated to the last ${sliced.output.length} of ${sliced.outputChars} characters. Pass a larger tail if you still need earlier lines.`;
        }
        return mcpJson({
          scriptName: snap.scriptName,
          running: snap.running,
          exitCode: snap.exitCode,
          output: sliced.output,
          truncated: sliced.truncated,
          outputChars: sliced.outputChars,
          hint,
          ref: threadRef,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  if (worktreeProfile) {
    server.tool(
      'notify_orchestrator',
      'Wake the parent Global orchestrator with a short status so it does not have to poll wait_for_turn. Use when you are blocked and the parent may have moved on (missing access, waiting on something the coordinator must handle). The message is shown on the sidebar and board until the next user message in this chat. ask_user already notifies for input-required — do not call this for the same question. Information only: never a git command. Do not use this to steer other worktrees.',
      {
        message: z
          .string()
          .min(1)
          .max(1500)
          .describe('Why you are blocked / what the parent should know (short).'),
        reason: z
          .enum(['input-required', 'blocked'])
          .optional()
          .describe(
            'input-required = waiting on the user in this chat; blocked = need the coordinator (default).',
          ),
      },
      async ({ message, reason }) => {
        try {
          const child = resolveNotifyCallerThread();
          const result = await notifyOrchestrator({
            child,
            reason: stampNotifyBlock(child.id, reason, message),
            message,
            send: (id, prompt, opts) => orch.send(id, prompt, opts),
          });
          if (!result.ok) {
            return {
              content: [{ type: 'text', text: result.error }],
              isError: true,
            };
          }
          return mcpJson({
            ok: true,
            parentThreadId: result.parentThreadId,
            reason: reason ?? 'blocked',
            ...(result.deduped ? { deduped: true } : {}),
          });
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text }], isError: true };
        }
      },
    );
  }

  registerScheduleTools(server);

  server.tool(
    'set_workspace_tags',
    worktreeProfile
      ? 'Update tags on this workspace (the checkout you are in). Omit ref to use this chat. mode=replace (default), add, or remove. Short labels — the same ones the orchestrator used for this task. You cannot retag a different checkout.'
      : 'Label a project workspace so related checkouts stay recognizable in the sidebar and on the phone. Pass any chat id on that workspace. Use the same tags on every workspace from one task. mode=replace is the default; add and remove change the set. create_workspace tags= sets them at create time. Not for orchestration chats.',
    {
      ref: z
        .string()
        .optional()
        .describe(
          worktreeProfile
            ? 'Omit for this chat. Another chat id only if it is on this same checkout.'
            : 'Chat id on the workspace to label.',
        ),
      tags: z
        .union([z.string(), z.array(z.string())])
        .describe('Labels to set. A string may be comma-separated.'),
      mode: z.enum(['replace', 'add', 'remove']).optional(),
    },
    async ({ ref, tags, mode }) => {
      try {
        const callerId = process.env[SIDEBOARD_THREAD_ID_ENV]?.trim() || '';
        const target = workspaceTagTargetRef({
          ownWorktreeOnly: worktreeProfile,
          caller: callerId ? orch.getThread(callerId) : null,
          requestedRef: ref,
          find: (id) => orch.getThread(id),
        });
        const thread = applyWorkspaceTags(target, tags, mode ?? 'replace');
        return mcpJson({
          id: thread.id,
          worktreePath: thread.worktreePath,
          tags: thread.tags ?? [],
          chats: workspaceAgentChatSummaries(thread.worktreePath),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return mcpJson({ ok: false, message }, true);
      }
    },
  );

  if (!worktreeProfile) {
  registerConnectedIssueVendorTools(server);
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
        return mcpJson(
          {
            ...state,
            ok: false,
            message:
              state.platform === 'darwin'
                ? 'Could not start caffeinate.'
                : 'Caffeinate is macOS only.',
          },
          true,
        );
      }
      return mcpJson({
        ...getCaffeinateHold(),
        ok: true,
        message: state.held
          ? 'Mac will stay awake until you call set_caffeinate with enabled=false, the user says they are done, or this orchestration chat is closed.'
          : 'Caffeinate hold released. The Mac can sleep (unless Settings caffeinate toggles are on).',
      });
    },
  );

  server.tool(
    'create_workspace',
    `Create a workspace (isolated git checkout + first chat) from branch, pr, or ticket. A ticket, PR, or named branch has one checkout — if one already matches, returns it (alreadyStarted=true) instead of a second checkout. That is not one agent: chats lists every agent on that checkout. Add another with fork_chat; send_to_chat only the chat that should do this job. Creating from the default branch still opens a new isolated checkout. Pass repoPath from list_projects. cowboy=true uses the project folder on the default branch (no isolated worktree; land is commit+push). From an orchestration chat, omit parentChatId (Sideboard binds the child to this chat) or pass the exact id from the turn reminder — never invent a uuid. Omit agent/model — Sideboard applies ${accountDefaultsHint}. Do not pass your own agent or agent=cursor; those are ignored. Setup (settings.toml, .cursor/worktrees.json, or script/setup) runs in the background in parallel with the first turn (skipped for cowboy). Pass the same tags on every workspace you open for one task (short labels such as "phone-sync") so they still match in the sidebar the next day. Reusing a checkout adds those tags.`,
    {
      sourceType: z.enum(['branch', 'pr', 'ticket']),
      sourceRef: z.string(),
      agent: z
        .enum(['claude', 'codex', 'opencode', 'brightsy', 'cursor'])
        .optional()
        .describe(
          `Usually omit. Sideboard uses Account default agent (${accountDefaults.agent}). Passing your own agent or cursor is ignored.`,
        ),
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
      parentChatId: z
        .string()
        .optional()
        .describe(
          'Orchestration: omit (preferred) or pass YOUR chat id from the turn reminder / AGENTS.md. Do not invent uuids.',
        ),
      parentThreadId: z
        .string()
        .optional()
        .describe('Legacy alias for parentChatId.'),
      tags: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'Short labels for this workspace (or a comma-separated string). Use the same tags on every checkout for one task. Added when the checkout already exists.',
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
    'Same as create_workspace for a ticket, PR, or named branch (attaches issue text when Sideboard can resolve it). Does not create a second checkout when one already matches — returns that workspace (alreadyStarted) and its chats. A workspace can have many agents. fork_chat to add one; send_to_chat only the chat that should do this job.',
    {
      kind: z.enum(['ticket', 'pr', 'branch']),
      ref: z
        .string()
        .describe('Ticket identifier (ENG-12), PR number (44), or branch name from list_board'),
      repoPath: z.string().describe('Project path from list_projects / list_board'),
      title: z.string().optional(),
      tags: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'Short labels for this workspace. Same tags on every checkout for one task. Added when the checkout already exists.',
        ),
    },
    async ({ kind, ref, repoPath, title, tags }) => {
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
        const tagged =
          tags === undefined
            ? orch.getThread(existing.id)
            : applyWorkspaceTags(existing.id, tags, 'add');
        return mcpJson({
          alreadyStarted: true,
          id: existing.id,
          title: existing.title,
          status: existing.status,
          tags: tagged?.tags ?? [],
          link: `sideboard://chat/${existing.id}`,
          chats: workspaceAgentChatSummaries(tagged?.worktreePath),
        });
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
            tags,
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
            tags,
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
          tags,
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
    'send_to_chat',
    'Steer a prompt on a workspace chat (Settings → Follow-up, default steer: interrupt the in-flight turn and start now, same as the workspace composer). Use after create_workspace to start or continue a conversation. For commit/push/PR, prefer ask_git (canonical desktop-button phrases). Send "Merge PR." / ask_git merge only when the user explicitly asked to merge. force_stop=true kills the in-flight turn and clears the queue before this prompt — only when the current request is wrong and must be replaced. Do not send_to_chat to check in, resume after a halt notice, or because wait_for_turn returned stillRunning; that interrupts the child mid-thought. Call wait_for_turn again instead.',
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
      const thread = await orch.send(ref, prompt, {
        followUp: resolveOrchChildFollowUp(),
      });
      return mcpJson({
        id: thread.id,
        status: thread.status,
        queueLength: thread.queue.length,
        forceStopped: Boolean(force_stop),
      });
    },
  );

  if (shouldRegisterMcpWaitForTurn()) {
  server.tool(
    'wait_for_turn',
    'Wait until the chat finishes its current/queued turn, or return early with a live progress snapshot. MCP clients often kill tools around 60s, so this returns within 45s even while the child is still working. taskState is the A2A-style lifecycle: submitted (queued, not started), working, input-required (ask_user), completed, failed, canceled. stillRunning is true only for submitted/working. blockedReason is why the child is waiting on a person (the question, plan approval, or a reported block) — read it and do not send_to_chat a check-in. If stillRunning, text and usage are empty (they would be the previous turn) — read progress and call wait_for_turn again. Do not send_to_chat a check-in (that steers / interrupts). On failed, lastError/text is the failure. On canceled, the child did not finish — resume with send_to_chat or tell the user. On input-required, wait for the user in that chat. When finished, text is this turn’s assistant reply and usage is that turn’s tokens + costUsd (this turn, not the Claude session total; sessionCostUsd is the provider session total when present).',
    {
      ref: z.string(),
      timeoutMs: z.number().optional(),
    },
    async ({ ref, timeoutMs }) => {
      const thread = await orch.waitForTurn(ref, mcpWaitForTurnTimeoutMs(timeoutMs), {
        resolveIfStillRunning: true,
      });
      const result = orch.getTurnResult(thread.id);
      return mcpJson(
        waitForTurnToolResult({
          id: thread.id,
          status: result.status,
          taskState: result.taskState,
          text: result.text,
          lastError: result.lastError,
          stillRunning: result.stillRunning,
          progress: result.progress,
          lastActivityAt: result.lastActivityAt,
          usage: result.usage,
          blockedReason: result.blockedReason, blockedSource: result.blockedSource,
        }),
      );
    },
  );
  }

  server.tool(
    'get_turn_result',
    'Assistant message and last-turn usage when the turn finished. While stillRunning (submitted/working), text and usage are empty so a previous reply cannot be mistaken for this turn — use progress for tools/thinking. Not the full transcript. Includes taskState (A2A lifecycle) and blockedReason (why the agent is waiting on a person).',
    { ref: z.string() },
    async ({ ref }) => {
      const result = orch.getTurnResult(ref);
      const hint = mcpWaitTaskHint(result.taskState, result.status, result.blockedReason);
      const waiting = Boolean(result.blockedReason) && !result.stillRunning && result.taskState !== 'failed' && result.taskState !== 'canceled';
      return mcpJson({
        ...result,
        hint,
        incomplete: needsCoordinatorAction(result.taskState) || waiting,
      });
    },
  );

  server.tool(
    'stop_chat',
    'Force-stop a thread: kill any in-flight agent turn AND clear queued prompts so drainQueue cannot continue. Does not archive the worktree. Optional force defaults to true. Pass reason — a short note on why this chat is stopping. It is stored on the thread and kept when the turn unwinds. If you omit it, Sideboard still records that the queue was cleared.',
    {
      ref: z.string(),
      force: z.boolean().optional(),
      reason: z
        .string()
        .optional()
        .describe('Why this chat is stopping. Stored on the thread for the next session.'),
    },
    async ({ ref, force, reason }) => {
      const t = orch.getThread(ref);
      if (!t) {
        return {
          content: [{ type: 'text', text: `Chat not found: ${ref}` }],
          isError: true,
        };
      }
      const clearQueue = force !== false;
      const hadQueued = t.queue.length > 0;
      const stopped = orch.stop(ref, { clearQueue, notifyParent: false, reason });
      return mcpJson({
        id: stopped.id,
        status: stopped.status,
        clearedQueue: clearQueue && hadQueued,
        lastError: stopped.lastError ?? null,
      });
    },
  );

  server.tool(
    'archive_chat',
    'Archive a thread (stops agent/dev, runs archive script, removes worktree when last chat tab). Coordinators commit, push, and open PRs by asking the worktree agent (ask_git). Merge only when the user explicitly asked.',
    { ref: z.string() },
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
    'restore_chat',
    'Restore an archived thread (recreates worktree from branch when needed)',
    { ref: z.string() },
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

  server.tool(
    'get_diff',
    'Compact diff summary (capped hunks, paginated)',
    {
      ref: z.string(),
      maxFiles: z.number().optional(),
    },
    async ({ ref, maxFiles }) => {
      const summary = await orch.diffSummary(ref);
      return mcpJson({
        ...summary,
        files: summary.files.slice(0, maxFiles ?? 10),
      });
    },
  );

  server.tool(
    'get_pr_checks',
    'Snapshot of GitHub PR checks for a worktree thread (`gh pr checks` plus merge/review gates). null = no PR. If the user gave a goal (Greptile 5/5, CI green), the worktree agent watches with `gh pr checks --watch` via /long-running — this tool is a snapshot, not a waiter. Coordinators: do not run gh from the orchestration cwd.',
    { ref: z.string().describe('Worktree thread id/ref') },
    async ({ ref }) => {
      try {
        const checks = await orch.getPrChecks(ref);
        return mcpJson(checks);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'request_review',
    'Start a merge-readiness Review on a worktree agent thread (same as the desktop Review button). If that worktree has a single unused idle agent (no messages), runs the review there; otherwise opens a new Review chat tab. Attaches .claude/skills/review/SKILL.md when present (else copies .sideboard/review.md into .context/review.md, or seeds that file from the stock template), and sends "Review changes in this workspace." Expect Approve / Approve with nits / Request changes / Needs more information in that chat. The review stays there so the user can read it and type next steps — do not comment on or update the PR or ticket, and do not ask_user after the review, until they ask. Pass a worktree thread ref — not the orchestrator. Then wait_for_turn (loop while stillRunning) / get_turn_result on the returned review thread id.',
    { ref: z.string().describe('Worktree thread id/ref to review') },
    async ({ ref }) => {
      try {
        const tab = await orch.requestReview(ref);
        const from = orch.getThread(ref);
        return mcpJson({
          id: tab.id,
          title: tab.title,
          status: tab.status,
          fromThreadId: from?.id ?? ref,
          link: `sideboard://chat/${tab.id}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'ask_git',
    'Commit & push, open a draft PR, mark ready for review, resolve conflicts, or merge — same prompts as the desktop git buttons (including Resolve). Always steers the worktree agent; does not push or open the PR locally. Then wait_for_turn (loop while stillRunning). Do not start a checks loop on a plain push — only if the user gave a goal (Greptile 5/5, CI green). Pass a worktree thread ref (not the orchestrator). action=ready-for-review and action=merge only when the user explicitly asked (or clicked the desktop button). Do not run git or gh from the orchestration cwd.',
    {
      ref: z.string().describe('Worktree thread id/ref'),
      action: z
        .enum(AGENT_GIT_ACTIONS)
        .describe(
          'commit-push | create-draft | create-web | resolve-conflicts | ready-for-review | merge',
        ),
    },
    async ({ ref, action }) => {
      try {
        const thread = await orch.askGit(ref, action);
        return mcpJson({
          id: thread.id,
          status: thread.status,
          queueLength: thread.queue.length,
          action,
          link: `sideboard://chat/${thread.id}`,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = formatGhLandError(raw);
        return mcpJson(
          {
            error: true,
            action,
            lastError: message,
            hint: /body is too long/i.test(message)
              ? 'Branch is already pushed. send_to_chat so the worktree agent runs gh pr create --draft --assignee @me -R <origin> --body-file <short.md>. Keep the description short.'
              : undefined,
          },
          true,
        );
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
        return mcpJson(catalogs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'fork_workspace',
    'Fork a worktree agent chat into a NEW git worktree + chat (desktop “Fork to new workspace”). Seeds a transcript (through through_index, default all). Optional agent override. Leave model unset for Auto (default) — only pass model when you have a reason. Not for the orchestrator. Then send_to_chat / wait_for_turn (loop while stillRunning) on the returned id.',
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
        return mcpJson({
          id: thread.id,
          title: thread.title,
          status: thread.status,
          agent: thread.agent,
          model: thread.model,
          branchName: thread.branchName,
          worktreePath: thread.worktreePath,
          fromThreadId: source?.id ?? ref,
          link: `sideboard://chat/${thread.id}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'fork_chat',
    'Add another agent chat on the SAME workspace (same files, Run, and git). Also forks a Global orchestration chat into a new orchestration tab. Pass agent when the new chat should use a different harness. Leave model unset for Auto unless you have a reason. Orchestration forks require an MCP-capable agent (claude, cursor, codex, opencode — not brightsy). Use this for a second agent on a checkout (review, another harness, parallel work on the same branch). Do not create_workspace again for that — it returns the existing checkout. Then send_to_chat / wait_for_turn (loop while stillRunning) on the returned id. Use fork_workspace only when the work needs its own git checkout.',
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
            content: [{ type: 'text', text: `Chat not found: ${ref}` }],
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
        return mcpJson({
          id: tab.id,
          title: tab.title,
          status: tab.status,
          agent: tab.agent,
          model: tab.model,
          sourceType: tab.sourceType,
          worktreePath: tab.worktreePath,
          fromThreadId: source.id,
          link: `sideboard://chat/${tab.id}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.tool(
    'run_setup',
    'Re-run workspace setup (Sideboard/Conductor settings, .cursor/worktrees.json, or script/setup). New worktrees already run this automatically.',
    { ref: z.string() },
    async ({ ref }) => {
      const result = await orch.runSetup(ref);
      return mcpJson(result);
    },
  );

  server.tool(
    'add_project',
    'Register a git repo as a Sideboard workspace',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      const ws = await orch.addWorkspace(repoPath);
      return mcpJson(ws);
    },
  );

  server.tool(
    'remove_project',
    'Unregister a Sideboard workspace and archive its chats',
    { repoPath: z.string() },
    async ({ repoPath }) => {
      await orch.removeWorkspace(repoPath);
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
      return mcpJson(
        threads.map((t) => ({
          id: t.id,
          agent: t.agent,
          branchName: t.branchName,
          worktreePath: t.worktreePath,
        })),
      );
    },
  );

  server.tool(
    'list_branches',
    'List git branches in a registered workspace. Pass repoPath from list_projects (unmerged into the default branch by default — for create_workspace sourceType=branch).',
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
    'List GitHub PRs for a registered workspace (the review surface for assigned ticket work — not the tickets). Pass repoPath from list_projects. "Get me N tickets to review" → queue=review and limit=N: open non-draft PRs labeled with this project\'s ready-for-review GitHub label (Settings → Projects; default eng-review) with no individual user reviewer. Prefer teams that match Settings → Agents / Projects roles for this repo. A team like engineering-team is not a claim (you are on that team). Also: state (open|closed|merged|all|review), label, reviewer (me|unassigned|login), query, limit (default 40, max 250). Then create_workspace with sourceType=pr.',
    {
      repoPath: z.string(),
      query: z.string().optional().describe('GitHub search tokens (title, draft:true, …)'),
      queue: z
        .enum(['review', 'mine', 'approved', 'changes'])
        .optional()
        .describe(
          'review = unclaimed ready-for-review inbox (Settings → Projects label, default eng-review). mine = review-requested:@me. approved / changes = eng-approved / eng-requested-changes.',
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
        reviewLabel: resolveProjectReviewLabel(loadAppSettings(), root),
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
      return mcpJson(stack);
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
      return mcpJson({
        stackNumber: result.stack.stackNumber,
        trunk: result.stack.trunk,
        threads: result.threads.map((t) => ({
          id: t.id,
          title: t.title,
          branchName: t.branchName,
          stackLayer: t.stackLayer,
          worktreePath: t.worktreePath,
          prUrl: t.prUrl,
          link: `sideboard://chat/${t.id}`,
        })),
      });
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
      return mcpJson({
        id: result.thread.id,
        title: result.thread.title,
        branchName: result.thread.branchName,
        stackLayer: result.thread.stackLayer,
        worktreePath: result.thread.worktreePath,
        link: `sideboard://chat/${result.thread.id}`,
      });
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
      return mcpJson({
        stackNumber: result.stack.stackNumber,
        trunk: result.stack.trunk,
        threads: result.threads.map((t) => ({
          id: t.id,
          title: t.title,
          branchName: t.branchName,
          stackLayer: t.stackLayer,
          worktreePath: t.worktreePath,
          link: `sideboard://chat/${t.id}`,
        })),
      });
    },
  );

  server.tool(
    'list_issues',
    'List or search issues (Linear, AbleTime, or GitHub; falls back to GitHub). Use Settings → Agents / Projects notes and roles to pick tickets relevant to the viewer (query + assignee=me or unassigned as the notes say). Default 40; pass query and/or limit (max 250) when truncated. assignee: me (Linear default), unassigned, all, or a user id. Pass updatedSince for new/updated tickets and new comments (“any updates since yesterday?”). Then create_workspace with sourceType=ticket.',
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
      updatedSince: mcpIssueUpdatedSinceSchema,
    },
    async ({ repoPath, query, assignee, limit, updatedSince }) => {
      const root = await resolveRepoRoot(repoPath);
      const page = clampMcpIssueLimit(limit);
      const result = await listIssues(root, {
        query,
        assignee,
        limit: page + 1,
        updatedSince,
      });
      return mcpJson(formatListedIssuesForMcp(result, page));
    },
  );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
