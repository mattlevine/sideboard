import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { pushTurnStderr, summarizeTurnStderr, formatTurnExitError, fallbackTurnFailDetail, looksLikeAgentFailureMessage, looksLikeInvalidAgentSession, humanizeAgentFailDetail } from '../agents/error-detail.js';
import { spawnAgentTurn, type SpawnTurnHandle } from '../agents/spawn.js';
import { getAdapter } from '../agents/index.js';
import {
  getPrChecks,
  getPrDetails,
  getPrMeta as fetchPrMeta,
  mergePr as mergeGithubPr,
  removeWorktree,
  resolveGithubRepoSlug,
  resolvePrSelector,
} from '../git/worktree.js';
import { getPrStack as fetchPrStack } from '../git/stack.js';
import { runSetupScript, startDevServer, runArchiveScript, listRunScripts, getRunMode } from '../hook/conductor.js';
import { runCursorWorktreeSetup } from '../hook/cursor-worktrees.js';
import {
  cleanupOrphanWorktrees,
  findOrphanWorktrees,
  shouldRunWorktreeCleanup,
} from '../git/orphan-cleanup.js';
import { applyThreadIntoMain } from '../git/apply-into-main.js';
import { cloneRepoIntoSideboard } from '../git/clone-repo.js';
import type { RunScript } from '../hook/settings.js';
import type {
  AgentKind,
  Autonomy,
  ActiveRun,
  CreateThreadInput,
  DiffScope,
  OrchestratorEvent,
  OrchestratorRuntime,
  PrCheckRun,
  PrDetails,
  PrMeta,
  PrStack,
  Thread,
  ThreadAttachment,
  ThreadOptionsPatch,
} from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';
import {
  appendMessage,
  deleteThreadRecord,
  findThreadByRef,
  listThreads,
  readThread,
  setStatus,
  updateThread,
  withThreadLock,
} from '../store/thread-store.js';
import { createThread } from '../threads/create.js';
import { assertOrchestratorCapableAgent } from '../agents/orchestrator-capable.js';

/** True when `kill(pid, 0)` succeeds (process exists and is signalable). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
import {
  createChatTab as createChatTabImpl,
  forkChatTab as forkChatTabImpl,
  threadsSharingWorktree,
} from '../threads/chat-tabs.js';
import { requestReview } from '../review/request-review.js';
import { forkThreadWorktree as forkThreadWorktreeImpl } from '../threads/fork-worktree.js';
import {
  createQuotaFailoverChat,
  planOrchestrationQuotaFailover,
  QUOTA_CONTINUE_PROMPT,
  QUOTA_RESUME_PROMPT,
} from './quota-failover.js';
import {
  adoptThread,
  importConductorWorkspaceAsync,
  listConductorWorkspaces,
} from '../threads/adopt.js';
import {
  addStackLayerFromThread,
  createPrStack,
  initStackFromThread,
  openPrStackLayers,
} from '../threads/stack-layers.js';
import { confirmLand, previewLand } from '../land/land.js';
import {
  captureTurnBaseline,
  getDiff,
  getDiffSummary,
  initializeGitRepository,
  listWorktreeFiles,
  readWorktreeFile,
  readWorktreeFileForUpload,
  writeWorktreeFile,
} from '../diff/diff.js';
import { discoverSkills, type SkillInfo } from '../skills/discover.js';
import { expandComposerPrompt } from '../composer/expand.js';
import {
  attachmentsFromWorktreePaths,
  stageAbsolutePathsAsAttachments,
  stageBuffersAsAttachments,
  type ComposerFileBuffer,
} from '../composer/stage-files.js';
import {
  buildSessionSeed,
  maybeCompactContext,
} from '../composer/context-compact.js';
import {
  formatAgentInstructions,
  formatArtifactDirective,
  formatRenameBranchDirective,
  formatWorktreeDirective,
  loadAgentInstructions,
} from '../agents/instructions.js';
import { PLAN_MODE_INSTRUCTION } from '../agents/types.js';
import {
  extractPresentedPlan,
  readPlanFile,
  writePlanFile,
} from '../plan/plan-file.js';
import { loadWorkspaceSettings } from '../hook/settings.js';
import { syncThreadBranchFromGit } from '../threads/sync-branch.js';
import {
  addWorkspace,
  removeWorkspace,
  syncWorkspacesFromThreads,
  type Workspace,
} from '../store/workspaces.js';
import {
  createGlobalChat,
  healOrchestrationSoccerTitles,
  isGlobalRepoPath,
  isGlobalThread,
  isOrchestratorThread,
  orchestratorSessionPoisonedByBuiltins,
} from '../store/global-workspace.js';
import {
  coordinatorSystemPrompt,
  coordinatorTurnReminder,
  enrichWorkspacesWithGithub,
  ensureGlobalCoordinatorCwd,
} from './coordinator-prompt.js';

interface RegisteredProcess {
  kind: 'agent' | 'dev' | 'setup';
  pid?: number;
  startedAt: string;
  scriptName?: string;
  kill: () => void;
}

export class Orchestrator {
  readonly events = new EventEmitter();
  private readonly processes = new Map<string, RegisteredProcess>();
  private readonly activeTurns = new Map<string, SpawnTurnHandle>();
  private readonly draining = new Set<string>();
  /** Threads past setStatus(running) but not yet in activeTurns (spawn in flight). */
  private readonly startingTurns = new Set<string>();
  /**
   * Threads intentionally force-stopped. Prevents runTurn from re-asserting
   * `running` after spawn, and from overwriting `stopped` with idle/error when
   * the killed turn's handle.done resolves.
   */
  private readonly stoppedTurns = new Set<string>();
  /**
   * Pause drainQueue after the in-flight turn unwinds (Stop with a preserved
   * queue). Cleared when the user sends or promotes a queued message again.
   */
  private readonly haltDrain = new Set<string>();
  /** WIP snapshot SHA at the start of the latest agent turn (per thread). */
  private readonly turnBaselines = new Map<string, string>();
  /** Timers for orchestration session-quota auto-resume. */
  private readonly quotaResumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private maxConcurrent: number;
  private runningCount = 0;

  constructor(opts?: { maxConcurrent?: number }) {
    this.maxConcurrent = opts?.maxConcurrent ?? 3;
  }

  on(listener: (event: OrchestratorEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  private emit(event: OrchestratorEvent): void {
    this.events.emit('event', event);
  }

  /** True when disk says running but this process is not actually turning. */
  private isStaleRunningThread(threadId: string, status: Thread['status']): boolean {
    return (
      status === 'running' &&
      !this.activeTurns.has(threadId) &&
      !this.startingTurns.has(threadId)
    );
  }

  /**
   * Cross-process guard: another Sideboard process (MCP stdio) may call reconcile
   * while the desktop still owns a live agent child. Never reclaim those.
   */
  private shouldReclaimRunningThread(thread: Thread): boolean {
    if (!this.isStaleRunningThread(thread.id, thread.status)) return false;
    const pid = thread.agentPid;
    if (typeof pid === 'number' && pid > 0 && isPidAlive(pid)) return false;
    return true;
  }

  async reconcile(
    repoPath?: string,
    opts?: {
      /**
       * When true, mark disk-status `running` threads with no in-process turn
       * (and no live agentPid) as stopped. Default false — MCP/CLI helpers must
       * not reclaim turns owned by the desktop orchestrator. Pass true only on
       * real app/CLI startup recovery.
       */
      reclaimStaleTurns?: boolean;
    },
  ): Promise<void> {
    const reclaimStaleTurns = opts?.reclaimStaleTurns === true;

    // Soccer nicknames for orchestration chats (incl. legacy cloud-goal titles).
    healOrchestrationSoccerTitles();

    for (const thread of listThreads({ includeArchived: true })) {
      if (thread.status === 'archived') continue;
      if (isGlobalThread(thread)) {
        // Ensure synthetic cwd + identity files; never mark global chats broken for git.
        ensureGlobalCoordinatorCwd();
        const heal: Parameters<typeof updateThread>[1] = {};
        // Heal chat tabs that were demoted from orchestration → branch (soccer-tab bug).
        if (thread.sourceType !== 'orchestration') {
          heal.sourceType = 'orchestration';
        }
        // Drop Claude --resume after Bash/ls “empty worktree” turns (pre --tools "").
        if (thread.sessionId && orchestratorSessionPoisonedByBuiltins(thread)) {
          heal.sessionId = null;
        }
        if (Object.keys(heal).length) {
          updateThread(thread.id, heal);
        }
        if (reclaimStaleTurns && this.shouldReclaimRunningThread(thread)) {
          setStatus(thread.id, 'stopped', 'Process died (reconciled on startup)');
          this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
        }
        continue;
      }
      if (!existsSync(thread.worktreePath)) {
        setStatus(thread.id, 'broken', 'Worktree missing on disk');
        this.emit({ type: 'status_changed', threadId: thread.id, status: 'broken' });
        continue;
      }
      if (reclaimStaleTurns && this.shouldReclaimRunningThread(thread)) {
        setStatus(thread.id, 'stopped', 'Process died (reconciled on startup)');
        this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
      }
    }

    const repoPaths = (
      repoPath
        ? [repoPath]
        : [...new Set(listThreads({ includeArchived: true }).map((t) => t.repoPath))]
    ).filter((p) => !isGlobalRepoPath(p));

    try {
      const orphans = await findOrphanWorktrees(repoPaths);
      if (orphans.length) {
        this.emit({
          type: 'orphan_worktrees',
          orphans: orphans.map((o) => ({ path: o.path, repoPath: o.repoPath })),
        });
      }
      const { autoCleanupOrphansEnabled } = await import('../store/app-settings.js');
      if (
        autoCleanupOrphansEnabled() &&
        shouldRunWorktreeCleanup() &&
        orphans.length > 0
      ) {
        await cleanupOrphanWorktrees({ repoPaths });
      }
    } catch {
      // Best-effort orphan discovery
    }

    // Drain any persisted queues (skip stopped — Stop parks the queue until the user resumes).
    for (const thread of listThreads()) {
      if (thread.queue.length > 0 && thread.status !== 'stopped') {
        void this.drainQueue(thread.id);
      }
    }

    // Re-arm session-quota wait timers (and fire any that are already due).
    this.schedulePendingQuotaResumes();
  }

  private clearQuotaResumeTimer(threadId: string): void {
    const timer = this.quotaResumeTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.quotaResumeTimers.delete(threadId);
  }

  /** Schedule (or fire) auto-retry after a provider session/usage limit reset. */
  private scheduleQuotaResume(threadId: string, resumeAt: Date): void {
    this.clearQuotaResumeTimer(threadId);
    updateThread(threadId, { quotaResumeAt: resumeAt.toISOString() });
    const delay = Math.max(5_000, resumeAt.getTime() - Date.now());
    // setTimeout overflow guard (~24.8 days).
    const capped = Math.min(delay, 2_147_483_647);
    const timer = setTimeout(() => {
      this.quotaResumeTimers.delete(threadId);
      void this.resumeAfterQuotaWait(threadId);
    }, capped);
    this.quotaResumeTimers.set(threadId, timer);
  }

  private schedulePendingQuotaResumes(): void {
    for (const thread of listThreads({ includeArchived: false })) {
      if (!thread.quotaResumeAt) continue;
      const at = new Date(thread.quotaResumeAt);
      if (Number.isNaN(at.getTime())) continue;
      if (at.getTime() <= Date.now()) {
        void this.resumeAfterQuotaWait(thread.id);
      } else if (!this.quotaResumeTimers.has(thread.id)) {
        this.scheduleQuotaResume(thread.id, at);
      }
    }
  }

  private async resumeAfterQuotaWait(threadId: string): Promise<void> {
    const thread = findThreadByRef(threadId);
    if (!thread || thread.status === 'archived') return;
    this.clearQuotaResumeTimer(threadId);
    try {
      updateThread(threadId, { quotaResumeAt: null });
    } catch {
      return;
    }
    if (
      thread.status === 'running' ||
      this.activeTurns.has(threadId) ||
      this.startingTurns.has(threadId)
    ) {
      return;
    }
    await this.send(threadId, QUOTA_RESUME_PROMPT);
  }

  /**
   * Host-side continue when an orchestration chat hits a provider session/usage
   * limit (not context size): switch agent (Auto) or wait until reset.
   */
  private async maybeHandleOrchestrationQuotaFailover(
    threadId: string,
    limitText: string,
  ): Promise<void> {
    const thread = findThreadByRef(threadId);
    if (!thread) return;
    const plan = planOrchestrationQuotaFailover(thread, limitText);
    if (!plan || plan.action === 'none') return;

    if (plan.action === 'wait_reset' && plan.resumeAt) {
      // Don't keep draining prompts against the limited account.
      this.haltDrain.add(threadId);
      this.scheduleQuotaResume(threadId, plan.resumeAt);
      setStatus(threadId, 'idle', null);
      appendMessage(threadId, {
        role: 'agent',
        text: `Sideboard will auto-retry this orchestration around ${plan.resumeAt.toLocaleString()} when the session limit resets.`,
        ts: new Date().toISOString(),
      });
      this.emit({
        type: 'quota_failover',
        threadId,
        action: 'wait_reset',
        message: plan.reason,
        resumeAt: plan.resumeAt.toISOString(),
      });
      this.emit({ type: 'status_changed', threadId, status: 'idle' });
      return;
    }

    if (plan.action === 'switch_agent' && plan.fallbackAgent) {
      this.haltDrain.add(threadId);
      const next = createQuotaFailoverChat(
        thread,
        plan.fallbackAgent,
        plan.limitText,
      );
      this.clearQuotaResumeTimer(threadId);
      try {
        updateThread(threadId, { quotaResumeAt: null });
      } catch {
        // ignore
      }
      appendMessage(threadId, {
        role: 'agent',
        text: `Session limit on ${thread.agent}. Sideboard continued on ${plan.fallbackAgent} (Auto) in [${next.title}](sideboard://thread/${next.id}).`,
        ts: new Date().toISOString(),
      });
      this.emit({
        type: 'quota_failover',
        threadId,
        action: 'switch_agent',
        toThreadId: next.id,
        message: plan.reason,
      });
      this.emit({
        type: 'status_changed',
        threadId: next.id,
        status: next.status,
      });
      await this.send(
        next.id,
        QUOTA_CONTINUE_PROMPT(thread.agent, plan.fallbackAgent),
      );
    }
  }

  getThreads(includeArchived = false): Thread[] {
    return listThreads({ includeArchived });
  }

  getThread(idOrRef: string): Thread | null {
    return findThreadByRef(idOrRef) ?? readThread(idOrRef);
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    const thread = await createThread(input);
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });

    // Return as soon as the worktree exists so the chat UI can open. Setup,
    // optional auto-run, and the first prompt continue in the background.
    void this.finishCreateThread(thread.id, input.prompt?.trim() || undefined);

    return thread;
  }

  private async finishCreateThread(
    threadId: string,
    prompt?: string,
  ): Promise<void> {
    await this.runSetupAfterCreate(threadId);

    const { autoRunAfterSetupEnabled } = await import('../store/app-settings.js');
    if (autoRunAfterSetupEnabled()) {
      try {
        await this.startDev(threadId);
      } catch {
        // Best-effort — setup/run script may be missing.
      }
    }

    if (prompt) {
      try {
        await this.send(threadId, prompt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateThread(threadId, {
          lastError: `First prompt failed: ${message}`,
        });
      }
    }
  }

  /** Run workspace setup after a new worktree is created (no-op if none configured). */
  private async runSetupAfterCreate(threadId: string): Promise<void> {
    try {
      await this.runSetup(threadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/no setup script/i.test(message)) return;
      if (/already running/i.test(message)) return;
      updateThread(threadId, {
        lastError: `Setup failed: ${message}`,
      });
    }
  }

  listWorkspaces(): Workspace[] {
    // Only active threads can discover new workspaces. Explicitly removed paths
    // stay dismissed (see removed-workspaces.json) even if archived history remains.
    const fromThreads = listThreads({ includeArchived: false }).map((t) => t.repoPath);
    return syncWorkspacesFromThreads(fromThreads);
  }

  async addWorkspace(repoPath: string): Promise<Workspace> {
    return addWorkspace(repoPath);
  }

  removeWorkspace(repoPath: string): void {
    removeWorkspace(repoPath);
  }

  async adopt(input: Parameters<typeof adoptThread>[0]): Promise<Thread> {
    const thread = await adoptThread(input);
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });
    return thread;
  }

  listConductor() {
    return listConductorWorkspaces();
  }

  async adoptFromConductor(workspaceId: string): Promise<Thread> {
    const thread = await importConductorWorkspaceAsync(workspaceId);
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });
    return thread;
  }

  async send(threadRef: string, prompt: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    return withThreadLock(thread.id, async () => {
      const current = this.requireThread(thread.id);
      const queue = [...current.queue, prompt];
      this.haltDrain.delete(thread.id);
      updateThread(thread.id, { queue, status: 'queued' });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue });
      this.emit({ type: 'status_changed', threadId: thread.id, status: 'queued' });
      void this.drainQueue(thread.id);
      return this.requireThread(thread.id);
    });
  }

  async fanOut(threadRefs: string[], prompt: string): Promise<Thread[]> {
    const results: Thread[] = [];
    for (const ref of threadRefs) {
      results.push(await this.send(ref, prompt));
    }
    return results;
  }

  /** Edit the text of a not-yet-started queued message. */
  async editQueuedMessage(threadRef: string, index: number, text: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    return withThreadLock(thread.id, async () => {
      const current = this.requireThread(thread.id);
      const trimmed = text.trim();
      if (!trimmed || index < 0 || index >= current.queue.length) {
        return current;
      }
      const queue = current.queue.map((p, i) => (i === index ? trimmed : p));
      updateThread(thread.id, { queue });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue });
      return this.requireThread(thread.id);
    });
  }

  /** Remove a not-yet-started queued message. */
  async removeQueuedMessage(threadRef: string, index: number): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    return withThreadLock(thread.id, async () => {
      const current = this.requireThread(thread.id);
      if (index < 0 || index >= current.queue.length) return current;
      const queue = current.queue.filter((_, i) => i !== index);
      const stillQueued = queue.length > 0;
      const inFlight = this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id);
      updateThread(thread.id, {
        queue,
        status: !stillQueued && !inFlight && current.status === 'queued' ? 'idle' : current.status,
      });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue });
      const next = this.requireThread(thread.id);
      this.emit({ type: 'status_changed', threadId: thread.id, status: next.status });
      return next;
    });
  }

  /**
   * Promote a queued message to run next, interrupting the in-flight turn (if any).
   * The current turn is stopped without clearing the rest of the queue — drainQueue
   * picks the promoted message up as soon as the interrupted turn unwinds.
   */
  async sendQueuedMessageNow(threadRef: string, index: number): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    const promoted = await withThreadLock(thread.id, async () => {
      const current = this.requireThread(thread.id);
      if (index < 0 || index >= current.queue.length) return false;
      const item = current.queue[index]!;
      const rest = current.queue.filter((_, i) => i !== index);
      const queue = [item, ...rest];
      this.haltDrain.delete(thread.id);
      updateThread(thread.id, { queue });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue });
      return true;
    });
    if (!promoted) return this.requireThread(thread.id);
    const inFlight = this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id);
    if (inFlight) {
      this.stop(thread.id, { clearQueue: false, continueQueue: true });
    } else {
      void this.drainQueue(thread.id);
    }
    return this.requireThread(thread.id);
  }

  private async drainQueue(threadId: string): Promise<void> {
    if (this.draining.has(threadId)) return;
    this.draining.add(threadId);
    try {
      while (true) {
        if (this.haltDrain.has(threadId)) {
          // Stop preserved the queue — leave it parked until the user resumes.
          break;
        }
        const thread = readThread(threadId);
        if (!thread || thread.queue.length === 0) {
          if (thread && thread.status === 'queued') {
            setStatus(threadId, 'idle');
            this.emit({ type: 'status_changed', threadId, status: 'idle' });
          }
          break;
        }
        if (this.runningCount >= this.maxConcurrent) {
          // Wait briefly and retry
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        if (this.activeTurns.has(threadId) || this.startingTurns.has(threadId)) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        // Cross-process / Cursor cloud: agent child may still be alive even if
        // this process briefly lost the handle — don't start a overlapping turn.
        const livePid = thread.agentPid;
        if (typeof livePid === 'number' && livePid > 0 && isPidAlive(livePid)) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        const prompt = thread.queue[0]!;
        const remaining = thread.queue.slice(1);
        updateThread(threadId, { queue: remaining });
        this.emit({ type: 'queue_changed', threadId, queue: remaining });
        await this.runTurn(threadId, prompt);
      }
    } finally {
      this.draining.delete(threadId);
    }
  }

  private async runTurn(threadId: string, prompt: string): Promise<void> {
    let thread = this.requireThread(threadId);
    // Drop Claude --resume when a Global chat previously acted like a worktree coder
    // (Bash on synthetic home, no Sideboard MCP) so identity prompts can re-seed.
    if (
      isGlobalThread(thread) &&
      thread.sessionId &&
      orchestratorSessionPoisonedByBuiltins(thread)
    ) {
      thread = updateThread(threadId, { sessionId: null });
    }
    this.runningCount += 1;
    const turnStartedAt = Date.now();
    // Mark before setStatus so concurrent reconcile (or MCP) won't reclaim us.
    this.startingTurns.add(threadId);
    setStatus(threadId, 'running');
    this.emit({ type: 'status_changed', threadId, status: 'running' });
    this.emit({ type: 'turn_started', threadId, prompt });

    try {
      const baseline = await captureTurnBaseline(thread.worktreePath);
      if (baseline) this.turnBaselines.set(threadId, baseline);
    } catch {
      // Best-effort — Changes "Last Agent Turn" filter stays unavailable.
    }

    // Compact oversized history before this turn so the agent session can reset.
    try {
      const compact = await maybeCompactContext(thread);
      if (compact.didCompact) {
        thread = updateThread(threadId, {
          messages: compact.thread.messages,
          sessionId: null,
        });
        this.emit({
          type: 'context_compacted',
          threadId,
          olderCount: compact.olderCount ?? 0,
          method: compact.method ?? 'extractive',
        });
      }
    } catch (err) {
      // Compaction is best-effort — never block the user turn.
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', threadId, message: `context compact failed: ${message}` });
      thread = this.requireThread(threadId);
    }

    const sentAttachments =
      thread.attachments.length > 0 ? [...thread.attachments] : undefined;
    appendMessage(threadId, {
      role: 'user',
      text: prompt,
      ...(sentAttachments ? { attachments: sentAttachments } : {}),
      ts: new Date().toISOString(),
    });

    thread = this.requireThread(threadId);
    const { agentPrompt: expandedPrompt } = expandComposerPrompt(
      thread.worktreePath,
      prompt,
      {
        attachments: sentAttachments ?? thread.attachments,
      },
    );
    // Re-assert on every turn (incl. Claude --resume, which drops cachedPrefix).
    // Sideboard plan mode stays on until the user toggles it off / Implement.
    // Orchestrators get a short identity reminder the same way — resume strips
    // the full playbook from cachedPrefix.
    const orchestrationReminder = isOrchestratorThread(thread)
      ? coordinatorTurnReminder({
          parentId: threadId,
          goal: thread.sourceRef || thread.title,
        })
      : null;
    // Re-assert on every turn (incl. Claude --resume, which drops cachedPrefix).
    const artifactReminder =
      thread.agent !== 'brightsy'
        ? [
            'Sideboard side column (important):',
            'There is no claude.ai Artifact tool here — that is normal.',
            'HTML/SVG/markdown: ```html fence or MCP present_artifact.',
            'CMS forms/tables: MCP present_schema (Brightsy resource_id or inline schema+schemaUi).',
            'Files column: MCP present_files (brightsy account storage or memory).',
            'Do not say artifacts/CMS UI are unavailable.',
          ].join(' ')
        : null;
    const agentPrompt = [
      thread.planMode ? PLAN_MODE_INSTRUCTION : null,
      orchestrationReminder,
      artifactReminder,
      expandedPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');
    const instructionFiles = loadAgentInstructions(thread.worktreePath, thread.agent);
    // Attachments are consumed on the first turn (like Conductor transcript chips).
    if (thread.attachments.length > 0) {
      updateThread(threadId, { attachments: [] });
    }

    // Re-resolve session before turn
    const adapter = getAdapter(thread.agent);
    const resolved = await adapter.resolveSessionId(thread.worktreePath, thread.sessionId);
    if (resolved && resolved !== thread.sessionId) {
      updateThread(threadId, { sessionId: resolved });
    }

    const fresh = this.requireThread(threadId);
    if (!fresh.worktreePath?.trim()) {
      throw new Error(
        `Thread ${threadId} has no worktreePath — refusing to start an agent outside an isolated worktree`,
      );
    }
    // Local agents need the worktree isolation rule on every turn (incl. resume).
    // Brightsy agents run hosted — they cannot edit the worktree or open PRs, and
    // stuffing those directives has contributed to empty model responses.
    const isBrightsy = fresh.agent === 'brightsy';
    const isOrchestration = isOrchestratorThread(fresh);
    // Orchestrators use Sideboard MCP across registered repos — not a single worktree PR playbook.
    const worktreeDirective =
      isBrightsy || isOrchestration
        ? null
        : formatWorktreeDirective(fresh, {
            githubSlug: await resolveGithubRepoSlug(fresh.worktreePath).catch(
              () => null,
            ),
          });
    const artifactDirective = isBrightsy ? null : formatArtifactDirective();
    const settings = loadWorkspaceSettings(fresh.worktreePath, fresh.repoPath);
    const { autoRenameBranchEnabled } = await import('../store/app-settings.js');
    const renameBranchDirective =
      !isBrightsy && !isOrchestration && autoRenameBranchEnabled()
        ? formatRenameBranchDirective(fresh, {
            customPrompt: settings?.prompts?.renameBranch,
          })
        : null;
    // Claude Code auto-loads CLAUDE.md / AGENTS.md for `-p` turns — duplicating
    // them in every user message wastes tokens and adds cache-breakpoint pressure.
    // Brightsy agents already carry their own server-side instructions; stuffing
    // local AGENTS.md into every turn has also triggered empty model responses.
    const instructions =
      fresh.agent === 'claude' || isBrightsy
        ? null
        : formatAgentInstructions(instructionFiles);
    // Fresh / compacted sessions have no CLI resume — seed from Sideboard history.
    let seed: string | null = null;
    if (!fresh.sessionId) {
      const prior = fresh.messages.slice(0, -1);
      // Brightsy has no session resume and rejects/empty-completes on oversized
      // tool-heavy seeds — keep a short text-only transcript.
      seed = isBrightsy
        ? buildSessionSeed(prior.slice(-6), { tools: 'none' })
        : buildSessionSeed(prior);
    }

    // Fresh orchestration sessions get the full fleet playbook + workspace inventory.
    // Every turn also gets coordinatorTurnReminder in agentPrompt; global cwd has CLAUDE.md.
    let coordinatorDirective: string | null = null;
    if (isOrchestration) {
      if (isGlobalThread(fresh)) ensureGlobalCoordinatorCwd();
      if (!fresh.sessionId) {
        const inventory = await enrichWorkspacesWithGithub(this.listWorkspaces());
        coordinatorDirective = coordinatorSystemPrompt({
          goal: fresh.sourceRef || fresh.title || 'Orchestration',
          parentId: fresh.id,
          workspaces: inventory,
          audience: 'desktop',
        });
      }
    }

    // Worktree directive for local agents (even on Claude resume). Project
    // instructions + seed only on fresh sessions / non-Claude agents.
    // Rename-branch is Conductor-style: only while still on the placeholder branch.
    const cachedPrefix = [
      coordinatorDirective,
      worktreeDirective,
      artifactDirective,
      renameBranchDirective,
      ...(fresh.agent === 'claude' && fresh.sessionId
        ? []
        : [instructions, seed]),
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    try {
      const stderrTail: string[] = [];
      const handle = await spawnAgentTurn(
        fresh,
        { cachedPrefix, prompt: agentPrompt },
        (event) => {
          this.emit({ type: 'turn_output', threadId, event });
          if (event.type === 'session_id') {
            updateThread(threadId, { sessionId: event.data });
          }
          if (event.type === 'stderr' && typeof event.data === 'string') {
            pushTurnStderr(stderrTail, event.data);
          }
          // Heal false "Process died (reconciled on startup)" while we still own the turn
          // (MCP subprocess reconcile used to stamp this mid tool-use).
          const live = readThread(threadId);
          if (
            live?.lastError?.includes('reconciled on startup') &&
            (this.activeTurns.has(threadId) || this.startingTurns.has(threadId))
          ) {
            setStatus(threadId, 'running');
            this.emit({ type: 'status_changed', threadId, status: 'running' });
          }
        },
      );
      this.activeTurns.set(threadId, handle);
      this.startingTurns.delete(threadId);
      if (typeof handle.pid === 'number' && handle.pid > 0) {
        updateThread(threadId, { agentPid: handle.pid });
      }
      // If stop() raced mid-spawn, kill immediately and do not re-assert running.
      if (this.stoppedTurns.has(threadId)) {
        handle.kill();
      } else {
        // Re-assert if a concurrent reconcile/MCP wiped running → stopped mid-spawn.
        const live = readThread(threadId);
        if (live && (live.status !== 'running' || live.lastError)) {
          setStatus(threadId, 'running');
          this.emit({ type: 'status_changed', threadId, status: 'running' });
        }
      }
      this.processes.set(`${threadId}:agent`, {
        kind: 'agent',
        pid: handle.pid,
        startedAt: new Date().toISOString(),
        kill: handle.kill,
      });

      const result = await handle.done;
      if (result.sessionId) {
        updateThread(threadId, { sessionId: result.sessionId });
      }
      let assistantText = result.assistantText.trim();
      let parts = result.parts;
      let usage = result.usage ?? undefined;
      let exitCode = result.exitCode;

      // Cursor: local runner can die mid-stream while the cloud agent finishes.
      // Recover the finished run from the SDK store so we don't strand the turn as bare exit 1.
      if (
        this.requireThread(threadId).agent === 'cursor' &&
        exitCode !== 0 &&
        !assistantText &&
        parts.length === 0
      ) {
        const sessionId =
          result.sessionId || this.requireThread(threadId).sessionId || '';
        if (sessionId) {
          const { recoverFinishedCursorRun } = await import('../agents/cursor-recover.js');
          // Poll briefly — cloud often finishes a few seconds after the local runner drops.
          for (let i = 0; i < 8; i++) {
            const recovered = recoverFinishedCursorRun({
              agentId: sessionId,
              startedAfterMs: turnStartedAt - 5_000,
            });
            if (recovered?.result) {
              assistantText = recovered.result;
              exitCode = 0;
              break;
            }
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      let lastStderr = summarizeTurnStderr(stderrTail);
      let detail =
        lastStderr ||
        (exitCode !== 0 ? fallbackTurnFailDetail(assistantText) : '');

      // Claude / Codex / OpenCode: stale --resume / --session ids fail the turn.
      // Drop the session and retry once with a seeded fresh CLI session (Cursor
      // already recovers busy/not-found inside cursor-runner).
      if (
        exitCode !== 0 &&
        !assistantText &&
        parts.length === 0 &&
        !this.stoppedTurns.has(threadId) &&
        looksLikeInvalidAgentSession(detail) &&
        this.requireThread(threadId).sessionId &&
        this.requireThread(threadId).agent !== 'cursor' &&
        this.requireThread(threadId).agent !== 'brightsy'
      ) {
        updateThread(threadId, { sessionId: null });
        pushTurnStderr(
          stderrTail,
          'Agent session missing — starting a fresh session',
        );
        this.emit({
          type: 'turn_output',
          threadId,
          event: {
            type: 'stderr',
            data: 'Agent session missing — starting a fresh session',
          },
        });
        const retryThread = this.requireThread(threadId);
        const prior = retryThread.messages.slice(0, -1);
        const retrySeed = buildSessionSeed(prior);
        const retryInstructions =
          retryThread.agent === 'claude'
            ? null
            : formatAgentInstructions(
                loadAgentInstructions(retryThread.worktreePath, retryThread.agent),
              );
        const retryPrefix = [
          coordinatorDirective,
          worktreeDirective,
          artifactDirective,
          renameBranchDirective,
          retryInstructions,
          retrySeed,
        ]
          .filter(Boolean)
          .join('\n\n---\n\n');
        const retryHandle = await spawnAgentTurn(
          retryThread,
          { cachedPrefix: retryPrefix, prompt: agentPrompt },
          (event) => {
            this.emit({ type: 'turn_output', threadId, event });
            if (event.type === 'session_id') {
              updateThread(threadId, { sessionId: event.data });
            }
            if (event.type === 'stderr' && typeof event.data === 'string') {
              pushTurnStderr(stderrTail, event.data);
            }
          },
        );
        this.activeTurns.set(threadId, retryHandle);
        if (typeof retryHandle.pid === 'number' && retryHandle.pid > 0) {
          updateThread(threadId, { agentPid: retryHandle.pid });
        }
        this.processes.set(`${threadId}:agent`, {
          kind: 'agent',
          pid: retryHandle.pid,
          startedAt: new Date().toISOString(),
          kill: retryHandle.kill,
        });
        if (this.stoppedTurns.has(threadId)) {
          retryHandle.kill();
        }
        const retryResult = await retryHandle.done;
        if (retryResult.sessionId) {
          updateThread(threadId, { sessionId: retryResult.sessionId });
        }
        assistantText = retryResult.assistantText.trim();
        parts = retryResult.parts;
        usage = retryResult.usage ?? undefined;
        exitCode = retryResult.exitCode;
        lastStderr = summarizeTurnStderr(stderrTail);
        detail =
          lastStderr ||
          (exitCode !== 0 ? fallbackTurnFailDetail(assistantText) : '');
      }

      // Prefer putting human-readable limit/auth failures in the agent bubble
      // (keeps duration/usage chips) instead of a bare lastError footer.
      let chatText = assistantText;
      if (
        exitCode !== 0 &&
        !chatText &&
        looksLikeAgentFailureMessage(detail)
      ) {
        chatText = humanizeAgentFailDetail(detail);
      }
      if (chatText || parts.length > 0) {
        appendMessage(threadId, {
          role: 'agent',
          text: chatText,
          parts: parts.length > 0 ? parts : undefined,
          durationMs: Math.max(0, Date.now() - turnStartedAt),
          usage,
          ts: new Date().toISOString(),
        });
      }
      // Claude may call ExitPlanMode after drafting a plan. Sideboard plan mode
      // is sticky until the user turns it off — drop the session so the next
      // turn re-enters plan mode with --permission-mode plan instead of resuming
      // an exited-plan Claude session.
      const afterTurn = this.requireThread(threadId);
      if (afterTurn.planMode && afterTurn.worktreePath?.trim()) {
        const presented = extractPresentedPlan(parts);
        const exited = parts.some(
          (p) => p.type === 'tool' && /exitplanmode/i.test(p.name),
        );
        if (presented?.content) {
          writePlanFile(afterTurn.worktreePath, presented.content);
        } else if (exited || (chatText && chatText.trim().length >= 400)) {
          // Fallback when the agent skipped present_plan but finished a plan.
          if (!readPlanFile(afterTurn.worktreePath) && chatText?.trim()) {
            writePlanFile(afterTurn.worktreePath, chatText.trim());
          }
        }
      }
      if (
        afterTurn.planMode &&
        afterTurn.agent === 'claude' &&
        parts.some(
          (p) => p.type === 'tool' && /exitplanmode/i.test(p.name),
        )
      ) {
        updateThread(threadId, { sessionId: null });
      }
      // Pick up agent `git branch -m` renames for sidebar labels.
      await syncThreadBranchFromGit(threadId);
      if (this.stoppedTurns.has(threadId)) {
        // Preserve intentional stop — do not overwrite with idle/error from kill exit.
        setStatus(threadId, 'stopped');
        this.emit({ type: 'status_changed', threadId, status: 'stopped' });
        this.emit({ type: 'turn_finished', threadId, exitCode });
      } else {
        const failDetail = formatTurnExitError(exitCode, detail);
        // When the agent bubble already shows the session/rate-limit (or similar)
        // message, skip the redundant "exit 1" / duplicate lastError footer.
        const explainedInChat =
          exitCode !== 0 &&
          Boolean(chatText) &&
          (looksLikeAgentFailureMessage(chatText) ||
            (failDetail &&
              chatText.includes(failDetail.replace(/^exit\s*\d+:\s*/i, '').trim())));
        setStatus(
          threadId,
          exitCode === 0 ? 'idle' : 'error',
          exitCode === 0 || explainedInChat ? null : failDetail,
        );
        this.emit({
          type: 'status_changed',
          threadId,
          status: exitCode === 0 ? 'idle' : 'error',
        });
        this.emit({ type: 'turn_finished', threadId, exitCode });
        if (exitCode !== 0) {
          const blob = [chatText, detail].filter(Boolean).join('\n');
          void this.maybeHandleOrchestrationQuotaFailover(threadId, blob);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await syncThreadBranchFromGit(threadId).catch(() => undefined);
      if (this.stoppedTurns.has(threadId)) {
        setStatus(threadId, 'stopped');
        this.emit({ type: 'status_changed', threadId, status: 'stopped' });
        this.emit({ type: 'turn_finished', threadId, exitCode: 1 });
      } else {
        setStatus(threadId, 'error', message);
        this.emit({ type: 'error', threadId, message });
        this.emit({ type: 'status_changed', threadId, status: 'error' });
        this.emit({ type: 'turn_finished', threadId, exitCode: 1 });
        void this.maybeHandleOrchestrationQuotaFailover(threadId, message);
      }
    } finally {
      this.startingTurns.delete(threadId);
      this.activeTurns.delete(threadId);
      this.processes.delete(`${threadId}:agent`);
      this.stoppedTurns.delete(threadId);
      this.runningCount = Math.max(0, this.runningCount - 1);
      try {
        updateThread(threadId, { agentPid: null });
      } catch {
        // Thread may have been purged mid-turn.
      }
    }
  }

  /**
   * Stop an in-flight agent turn.
   *
   * - Default `clearQueue: true` (force-stop): empties queued prompts so nothing
   *   resumes. Used by MCP force-stop, archive, and cloud-connect.
   * - Desktop Stop uses `{ clearQueue: false }` so follow-ups stay editable.
   * - `continueQueue: true` (Send now): keep the queue and let drainQueue resume
   *   after the interrupted turn unwinds. Without it, drain pauses until send /
   *   promote.
   */
  stop(
    threadRef: string,
    opts?: { clearQueue?: boolean; continueQueue?: boolean },
  ): Thread {
    const clearQueue = opts?.clearQueue !== false;
    const continueQueue = opts?.continueQueue === true;
    const thread = this.requireThread(threadRef);
    const inFlight =
      this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id);
    // Only sticky-mark when a turn is in flight — otherwise a later send/runTurn
    // would inherit a stale stop and treat a normal finish as intentional stop.
    if (inFlight) {
      this.stoppedTurns.add(thread.id);
    }
    if (clearQueue && thread.queue.length > 0) {
      this.haltDrain.delete(thread.id);
      updateThread(thread.id, { queue: [] });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue: [] });
    } else if (!clearQueue && !continueQueue) {
      // Preserve queue but do not auto-start the next prompt after this stop.
      this.haltDrain.add(thread.id);
    } else if (continueQueue) {
      this.haltDrain.delete(thread.id);
    }
    const handle = this.activeTurns.get(thread.id);
    if (handle) handle.kill();
    const proc = this.processes.get(`${thread.id}:agent`);
    if (proc) proc.kill();
    setStatus(thread.id, 'stopped');
    this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
    return this.requireThread(thread.id);
  }

  async startDev(
    threadRef: string,
    scriptName?: string,
  ): Promise<{ port: number; scriptName: string; ports: number[] }> {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Run script');
    const scripts = listRunScripts(thread.worktreePath, thread.repoPath);
    const resolvedName =
      scriptName ??
      scripts.find((s) => s.default === true)?.name ??
      scripts.find((s) => s.name === 'dev')?.name ??
      scripts.find((s) => s.name !== 'all')?.name ??
      scripts[0]?.name;
    if (!resolvedName) {
      throw new Error(
        'No run script found for this worktree. Add [scripts.run.*] in the worktree’s .sideboard/settings.toml or .conductor/settings.toml (or settings.local.toml on the main repo).',
      );
    }

    const runKey = `${thread.id}:run:${resolvedName}`;
    const existing = this.processes.get(runKey);
    const active = (thread.activeRuns ?? []).find((r) => r.scriptName === resolvedName);
    if (existing && active) {
      return { port: active.port, scriptName: resolvedName, ports: active.ports };
    }
    // Legacy key
    if (!scriptName) {
      const legacy = this.processes.get(`${thread.id}:dev`);
      if (legacy && thread.devPort) {
        return { port: thread.devPort, scriptName: resolvedName, ports: [thread.devPort] };
      }
    }

    const mode = getRunMode(thread.worktreePath, thread.repoPath);
    if (mode === 'nonconcurrent') {
      for (const t of listThreads()) {
        if (t.id === thread.id) continue;
        const runs = t.activeRuns ?? [];
        if (runs.length > 0 || t.devPort) {
          throw new Error(
            `run_mode is nonconcurrent — stop running scripts on thread ${t.id.slice(0, 8)} first`,
          );
        }
      }
    }

    const handle = await startDevServer(
      thread.repoPath,
      thread.worktreePath,
      (line) => {
        this.emit({
          type: 'run_output',
          threadId: thread.id,
          scriptName: resolvedName,
          line,
        });
      },
      { scriptName: resolvedName },
    );
    if (!handle) {
      throw new Error(`Run script not found: ${resolvedName}`);
    }

    const startedAt = new Date().toISOString();
    this.processes.set(runKey, {
      kind: 'dev',
      pid: handle.pid,
      startedAt,
      scriptName: resolvedName,
      kill: handle.kill,
    });
    // Keep legacy :dev key for default script
    const isDefault =
      scripts.find((s) => s.default)?.name === resolvedName ||
      (!scripts.some((s) => s.default) &&
        (resolvedName === 'dev' || resolvedName === scripts[0]?.name));
    if (isDefault) {
      this.processes.set(`${thread.id}:dev`, {
        kind: 'dev',
        pid: handle.pid,
        startedAt,
        scriptName: resolvedName,
        kill: handle.kill,
      });
    }

    const run: ActiveRun = {
      scriptName: resolvedName,
      port: handle.port,
      ports: handle.ports,
      startedAt,
    };
    const nextRuns = [
      ...(thread.activeRuns ?? []).filter((r) => r.scriptName !== resolvedName),
      run,
    ];
    updateThread(thread.id, {
      activeRuns: nextRuns,
      devPort: isDefault ? handle.port : thread.devPort,
    });
    this.emit({
      type: 'dev_server_started',
      threadId: thread.id,
      port: handle.port,
      scriptName: resolvedName,
    });
    void handle.done.then(() => {
      this.processes.delete(runKey);
      if (isDefault) this.processes.delete(`${thread.id}:dev`);
      const latest = readThread(thread.id);
      const remaining = (latest?.activeRuns ?? []).filter(
        (r) => r.scriptName !== resolvedName,
      );
      updateThread(thread.id, {
        activeRuns: remaining,
        devPort: isDefault ? null : latest?.devPort ?? null,
      });
      this.emit({
        type: 'dev_server_stopped',
        threadId: thread.id,
        scriptName: resolvedName,
      });
    });
    return { port: handle.port, scriptName: resolvedName, ports: handle.ports };
  }

  stopDev(threadRef: string, scriptName?: string): void {
    const thread = this.requireThread(threadRef);
    if (scriptName) {
      const runKey = `${thread.id}:run:${scriptName}`;
      const proc = this.processes.get(runKey);
      if (proc) proc.kill();
      this.processes.delete(runKey);
      const remaining = (thread.activeRuns ?? []).filter((r) => r.scriptName !== scriptName);
      const isPrimary = thread.devPort != null &&
        thread.activeRuns?.find((r) => r.scriptName === scriptName)?.port === thread.devPort;
      updateThread(thread.id, {
        activeRuns: remaining,
        devPort: isPrimary ? null : thread.devPort,
      });
      this.emit({ type: 'dev_server_stopped', threadId: thread.id, scriptName });
      return;
    }
    // Stop all run scripts for this thread
    for (const [key, proc] of [...this.processes.entries()]) {
      if (key.startsWith(`${thread.id}:run:`) || key === `${thread.id}:dev`) {
        proc.kill();
        this.processes.delete(key);
      }
    }
    updateThread(thread.id, { activeRuns: [], devPort: null });
    this.emit({ type: 'dev_server_stopped', threadId: thread.id });
  }

  listThreadRunScripts(threadRef: string): RunScript[] {
    const thread = this.requireThread(threadRef);
    return listRunScripts(thread.worktreePath, thread.repoPath);
  }

  getActiveRuns(threadRef: string): ActiveRun[] {
    return this.requireThread(threadRef).activeRuns ?? [];
  }

  async runSetup(threadRef: string): Promise<{ exitCode: number | null; source?: string | null }> {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Setup');
    const key = `${thread.id}:setup`;
    if (this.processes.has(key)) {
      throw new Error('Setup already running for this thread');
    }

    const abort = new AbortController();
    this.processes.set(key, {
      kind: 'setup',
      startedAt: new Date().toISOString(),
      kill: () => abort.abort(),
    });
    this.emit({ type: 'setup_started', threadId: thread.id });

    try {
      let setup = await runSetupScript(
        thread.repoPath,
        thread.worktreePath,
        (line) => {
          this.emit({ type: 'setup_output', threadId: thread.id, line });
        },
        { signal: abort.signal },
      );

      // Fall back to Cursor .cursor/worktrees.json when no Sideboard/Conductor setup
      if (!setup.ran) {
        setup = await runCursorWorktreeSetup(
          thread.repoPath,
          thread.worktreePath,
          (line) => {
            this.emit({ type: 'setup_output', threadId: thread.id, line });
          },
        );
      }

      if (!setup.ran) {
        throw new Error(
          'No setup script in .sideboard/settings.toml, .conductor/settings.toml, or .cursor/worktrees.json',
        );
      }
      if (setup.exitCode !== 0 && setup.exitCode !== null) {
        updateThread(thread.id, {
          lastError: `Setup exited ${setup.exitCode}`,
        });
      }
      this.emit({ type: 'setup_finished', threadId: thread.id, exitCode: setup.exitCode });
      return { exitCode: setup.exitCode, source: setup.source };
    } finally {
      this.processes.delete(key);
    }
  }

  cancelSetup(threadRef: string): void {
    const thread = this.requireThread(threadRef);
    const proc = this.processes.get(`${thread.id}:setup`);
    if (proc) proc.kill();
  }

  async applyIntoMain(
    threadRef: string,
    opts?: { method?: 'merge' | 'cherry-pick'; targetBranch?: string },
  ) {
    const thread = this.requireThread(threadRef);
    return applyThreadIntoMain(thread, opts);
  }

  async cloneRepo(url: string, name?: string) {
    return cloneRepoIntoSideboard({ url, name });
  }

  async listOrphanWorktrees(repoPath?: string) {
    const repos = repoPath
      ? [repoPath]
      : [...new Set(listThreads({ includeArchived: true }).map((t) => t.repoPath))];
    return findOrphanWorktrees(repos);
  }

  async cleanupOrphans(opts?: { dryRun?: boolean; maxCount?: number; repoPath?: string }) {
    const repoPaths = opts?.repoPath
      ? [opts.repoPath]
      : [...new Set(listThreads({ includeArchived: true }).map((t) => t.repoPath))];
    return cleanupOrphanWorktrees({
      dryRun: opts?.dryRun,
      maxCount: opts?.maxCount,
      repoPaths,
    });
  }

  /**
   * Best-of-n / fanout: create N threads (one per agent) with the same prompt.
   */
  async bestOfN(opts: {
    prompt: string;
    agents: AgentKind[];
    repoPath: string;
    sourceType?: 'branch' | 'pr' | 'ticket';
    sourceRef?: string;
    title?: string;
  }): Promise<Thread[]> {
    const agents = opts.agents.length ? opts.agents : (['claude'] as AgentKind[]);
    const sourceType = opts.sourceType ?? 'branch';
    const sourceRef = opts.sourceRef ?? 'default';
    const created: Thread[] = [];
    for (const agent of agents) {
      const thread = await this.createThread({
        sourceType,
        sourceRef,
        agent,
        repoPath: opts.repoPath,
        title: opts.title
          ? `${opts.title} (${agent})`
          : `best-of-n: ${opts.prompt.slice(0, 48)} (${agent})`,
        prompt: opts.prompt,
      });
      created.push(thread);
    }
    return created;
  }

  async waitForTurn(threadRef: string, timeoutMs = 600_000): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    const start = Date.now();
    return new Promise((resolve, reject) => {
      if (!['running', 'queued'].includes(thread.status)) {
        resolve(thread);
        return;
      }
      const off = this.on((event) => {
        if (event.type === 'turn_finished' && event.threadId === thread.id) {
          off();
          resolve(this.requireThread(thread.id));
        }
        if (event.type === 'error' && event.threadId === thread.id) {
          off();
          resolve(this.requireThread(thread.id));
        }
      });
      const timer = setInterval(() => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          off();
          reject(new Error('wait_for_turn timed out'));
        }
        const current = readThread(thread.id);
        if (current && !['running', 'queued'].includes(current.status)) {
          clearInterval(timer);
          off();
          resolve(current);
        }
      }, 200);
    });
  }

  getTurnResult(threadRef: string): { text: string; status: string; sessionId: string | null } {
    const thread = this.requireThread(threadRef);
    const lastAgent = [...thread.messages].reverse().find((m) => m.role === 'agent');
    return {
      text: lastAgent?.text ?? '',
      status: thread.status,
      sessionId: thread.sessionId,
    };
  }

  private assertNotGlobal(thread: Thread, action: string): void {
    if (isGlobalThread(thread)) {
      throw new Error(`${action} is not available on the global coordinator`);
    }
  }

  async diff(
    threadRef: string,
    opts?: { scope?: DiffScope; commitSha?: string | null },
  ) {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Diff');
    return getDiff(thread.worktreePath, thread.repoPath, {
      scope: opts?.scope,
      commitSha: opts?.commitSha,
      lastTurnBase: this.turnBaselines.get(thread.id) ?? null,
    });
  }

  async diffSummary(threadRef: string) {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Diff');
    return getDiffSummary(thread.worktreePath, thread.repoPath);
  }

  async initializeGit(threadRef: string): Promise<void> {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Initialize git');
    await initializeGitRepository(thread.worktreePath);
  }

  async listFiles(threadRef: string): Promise<string[]> {
    const thread = this.requireThread(threadRef);
    return listWorktreeFiles(thread.worktreePath);
  }

  async readFile(
    threadRef: string,
    relativePath: string,
  ): Promise<{
    path: string;
    content: string;
    truncated: boolean;
    binary: boolean;
    encoding: 'utf8' | 'base64';
  }> {
    const thread = this.requireThread(threadRef);
    // Prevent path escape
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      throw new Error('Invalid path');
    }
    return readWorktreeFile(thread.worktreePath, relativePath);
  }

  async readFileForUpload(
    threadRef: string,
    relativePath: string,
  ): Promise<{ path: string; contentBase64: string; size: number }> {
    const thread = this.requireThread(threadRef);
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      throw new Error('Invalid path');
    }
    return readWorktreeFileForUpload(thread.worktreePath, relativePath);
  }

  async writeFile(threadRef: string, relativePath: string, content: string): Promise<{ path: string }> {
    const thread = this.requireThread(threadRef);
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      throw new Error('Invalid path');
    }
    return writeWorktreeFile(thread.worktreePath, relativePath, content);
  }

  listSkills(threadRef: string): SkillInfo[] {
    const thread = this.requireThread(threadRef);
    return discoverSkills(thread.worktreePath);
  }

  async previewLand(threadRef: string) {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Land');
    return previewLand(thread);
  }

  async confirmLand(threadRef: string, opts?: { draft?: boolean; web?: boolean }) {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Land');
    const result = await confirmLand(thread, opts);
    if (result.prUrl) {
      const patch: Partial<Thread> = { prUrl: result.prUrl };
      try {
        const meta = await fetchPrMeta(thread.worktreePath, result.prUrl);
        if (meta?.title) patch.prTitle = meta.title;
      } catch {
        // ignore — URL alone is enough
      }
      updateThread(thread.id, patch);
      await syncThreadBranchFromGit(thread.id);
    }
    return result;
  }

  async mergePr(threadRef: string): Promise<{ url: string; state: string }> {
    const { thread, selector, cwd } = await this.withPrSelector(threadRef);
    this.assertNotGlobal(thread, 'Merge PR');
    if (!selector) throw new Error('No pull request linked to this thread');
    const result = await mergeGithubPr(cwd, selector);
    if (result.url && result.url !== thread.prUrl) {
      updateThread(thread.id, { prUrl: result.url });
    }
    return result;
  }

  /** Resolve PR selector and optionally persist `prUrl` when found. */
  private async withPrSelector(threadRef: string): Promise<{
    thread: Thread;
    selector: string | null;
    cwd: string;
  }> {
    const thread = this.requireThread(threadRef);
    const selector = resolvePrSelector(thread);
    const cwd = thread.worktreePath;
    if (!cwd?.trim()) {
      throw new Error(`Thread ${threadRef} has no worktreePath`);
    }
    return { thread, selector, cwd };
  }

  async getPrChecks(threadRef: string): Promise<PrCheckRun[] | null> {
    const { selector, cwd } = await this.withPrSelector(threadRef);
    if (!selector) return null;
    return getPrChecks(cwd, selector);
  }

  async getPrMeta(threadRef: string): Promise<PrMeta | null> {
    const { thread, selector, cwd } = await this.withPrSelector(threadRef);
    if (!selector) return null;
    const meta = await fetchPrMeta(cwd, selector);
    if (meta) {
      const patch: Partial<Thread> = {};
      if (meta.url && meta.url !== thread.prUrl) patch.prUrl = meta.url;
      if (meta.title && meta.title !== thread.prTitle) patch.prTitle = meta.title;
      if (Object.keys(patch).length > 0) {
        updateThread(thread.id, patch);
        const latest = this.requireThread(thread.id);
        if (!latest.userSetTitle && meta.title && latest.title !== meta.title) {
          updateThread(thread.id, { title: meta.title });
        }
      }
    }
    return meta;
  }

  async getPrStack(threadRef: string): Promise<PrStack | null> {
    const thread = this.requireThread(threadRef);
    if (!thread.worktreePath?.trim()) return null;
    const stack = await fetchPrStack(thread.worktreePath);
    if (!stack) return null;
    const current = stack.currentIndex >= 0 ? stack.layers[stack.currentIndex] : null;
    const patch: Partial<Thread> = {};
    if (stack.stackNumber != null) {
      const id = `gh-stack-${stack.stackNumber}`;
      if (thread.stackId !== id) patch.stackId = id;
    }
    if (current?.position != null && thread.stackLayer !== current.position) {
      patch.stackLayer = current.position;
    }
    if (current?.prUrl && current.prUrl !== thread.prUrl) patch.prUrl = current.prUrl;
    if (current?.title && current.title !== thread.prTitle) patch.prTitle = current.title;
    if (current?.branchName && current.branchName !== thread.branchName) {
      patch.branchName = current.branchName;
    }
    if (Object.keys(patch).length > 0) updateThread(thread.id, patch);
    return stack;
  }

  /** Open worktrees for all (or one) stack layers discovered from a thread. */
  async openPrStackLayers(
    threadRef: string,
    opts?: { layer?: number },
  ): Promise<{ stack: PrStack; threads: Thread[] }> {
    const result = await openPrStackLayers({ threadRef, layer: opts?.layer });
    for (const t of result.threads) {
      this.emit({ type: 'status_changed', threadId: t.id, status: t.status });
    }
    for (const id of result.createdThreadIds) {
      await this.runSetupAfterCreate(id);
    }
    return { stack: result.stack, threads: result.threads };
  }

  /** Add a branch on top of the thread's stack and open its worktree. */
  async addStackLayer(
    threadRef: string,
    branchName: string,
    opts?: { title?: string },
  ): Promise<{ stack: PrStack; thread: Thread }> {
    const result = await addStackLayerFromThread({
      threadRef,
      branchName,
      title: opts?.title,
    });
    this.emit({
      type: 'status_changed',
      threadId: result.thread.id,
      status: result.thread.status,
    });
    if (result.createdWorktree) {
      await this.runSetupAfterCreate(result.thread.id);
    }
    return { stack: result.stack, thread: result.thread };
  }

  /** Initialize a stack from the current thread branch (optional extra layers). */
  async initStackFromThread(
    threadRef: string,
    opts?: { additionalBranches?: string[]; base?: string },
  ): Promise<{ stack: PrStack; threads: Thread[] }> {
    const result = await initStackFromThread({
      threadRef,
      additionalBranches: opts?.additionalBranches,
      base: opts?.base,
    });
    for (const t of result.threads) {
      this.emit({ type: 'status_changed', threadId: t.id, status: t.status });
    }
    for (const id of result.createdThreadIds) {
      await this.runSetupAfterCreate(id);
    }
    return { stack: result.stack, threads: result.threads };
  }

  /** Create a new multi-layer stack with one worktree per layer. */
  async createPrStack(input: {
    repoPath: string;
    branches: string[];
    base?: string;
    agent: AgentKind;
    autonomy?: Autonomy;
    model?: string | null;
    effort?: ThinkingEffort;
    fast?: boolean;
    planMode?: boolean;
    title?: string;
  }): Promise<{ stack: PrStack; threads: Thread[] }> {
    const result = await createPrStack(input);
    for (const t of result.threads) {
      this.emit({ type: 'status_changed', threadId: t.id, status: t.status });
    }
    for (const id of result.createdThreadIds) {
      await this.runSetupAfterCreate(id);
    }
    return { stack: result.stack, threads: result.threads };
  }

  async getPrDetails(threadRef: string): Promise<PrDetails | null> {
    const { thread, selector, cwd } = await this.withPrSelector(threadRef);
    if (!selector) return null;
    const details = await getPrDetails(cwd, selector);
    if (details) {
      const patch: Partial<Thread> = {};
      if (details.url && details.url !== thread.prUrl) patch.prUrl = details.url;
      if (details.title && details.title !== thread.prTitle) patch.prTitle = details.title;
      if (Object.keys(patch).length > 0) {
        updateThread(thread.id, patch);
        // Refresh cached sidebar title from PR when not user-overridden.
        const latest = this.requireThread(thread.id);
        if (!latest.userSetTitle && details.title && latest.title !== details.title) {
          updateThread(thread.id, { title: details.title });
        }
      }
    }
    return details;
  }

  setAutonomy(threadRef: string, autonomy: Autonomy): Thread {
    return this.setThreadOptions(threadRef, { autonomy });
  }

  /**
   * Open a Review chat tab on a worktree thread (same as the desktop Review button)
   * and send the merge-readiness prefill.
   */
  async requestReview(threadRef: string): Promise<Thread> {
    const { tab } = await requestReview(threadRef, (ref, prompt) => this.send(ref, prompt));
    this.emit({ type: 'status_changed', threadId: tab.id, status: tab.status });
    return tab;
  }

  setThreadOptions(threadRef: string, patch: ThreadOptionsPatch): Thread {
    const thread = this.requireThread(threadRef);
    const next: Partial<Thread> = {};
    if (patch.autonomy !== undefined) next.autonomy = patch.autonomy;
    if (patch.effort !== undefined) next.effort = patch.effort;
    if (patch.fast !== undefined) next.fast = patch.fast;
    if (patch.planMode !== undefined) next.planMode = patch.planMode;
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.agent !== undefined) {
      if (patch.agent !== thread.agent) {
        if (thread.messages.length > 0) {
          throw new Error(
            `Cannot switch agent provider mid-chat (${thread.agent} → ${patch.agent}). Start a new chat tab instead.`,
          );
        }
        if (isOrchestratorThread(thread)) {
          assertOrchestratorCapableAgent(patch.agent);
        }
        next.agent = patch.agent;
        // Model aliases are agent-specific; clear when switching unless the patch
        // also sets a new model (Brightsy uses model for agent:/model: targets).
        if (patch.agent !== 'claude' && patch.model === undefined) next.model = null;
        // Session ids are agent-specific — never resume Claude/Codex under Brightsy.
        next.sessionId = null;
      }
    }
    return updateThread(thread.id, next);
  }

  createChatTab(input: {
    fromThreadId: string;
    agent?: Thread['agent'];
    model?: string | null;
    autonomy?: Thread['autonomy'];
    effort?: Thread['effort'];
    fast?: boolean;
    title?: string;
    attachments?: Thread['attachments'];
  }): Thread {
    return createChatTabImpl(input);
  }

  forkChatTab(input: {
    threadId: string;
    throughIndex?: number;
    agent?: Thread['agent'];
    model?: string | null;
    title?: string;
  }): Thread {
    return forkChatTabImpl(input);
  }

  async forkThreadWorktree(input: {
    threadId: string;
    throughIndex?: number;
    agent?: Thread['agent'];
    model?: string | null;
    title?: string;
  }): Promise<Thread> {
    const thread = await forkThreadWorktreeImpl(input);
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });
    await this.runSetupAfterCreate(thread.id);
    return thread;
  }

  renameThread(threadRef: string, title: string): Thread {
    const thread = this.requireThread(threadRef);
    const next = title.trim();
    if (!next) throw new Error('Title cannot be empty');
    return updateThread(thread.id, { title: next, userSetTitle: true });
  }

  setAttachments(
    threadRef: string,
    attachments: Thread['attachments'],
  ): Thread {
    return updateThread(this.requireThread(threadRef).id, { attachments });
  }

  /**
   * Stage OS / worktree files into composer attachments (copies external files
   * into `.context/attachments/` so agents can Read images and binaries).
   */
  attachComposerFiles(
    threadRef: string,
    opts: {
      absolutePaths?: string[];
      relativePaths?: string[];
      buffers?: ComposerFileBuffer[];
    },
  ): ThreadAttachment[] {
    const thread = this.requireThread(threadRef);
    const fromAbs = stageAbsolutePathsAsAttachments(
      thread.worktreePath,
      opts.absolutePaths ?? [],
    );
    const fromRel = attachmentsFromWorktreePaths(
      thread.worktreePath,
      opts.relativePaths ?? [],
    );
    const fromBuf = stageBuffersAsAttachments(thread.worktreePath, opts.buffers ?? []);
    return [...fromAbs, ...fromRel, ...fromBuf];
  }

  listWorktreeChats(threadRef: string): Thread[] {
    const thread = this.requireThread(threadRef);
    return threadsSharingWorktree(thread.worktreePath);
  }

  async archive(threadRef: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id);
    if (isGlobalThread(thread)) {
      return setStatus(thread.id, 'archived');
    }
    const siblings = threadsSharingWorktree(thread.worktreePath).filter((t) => t.id !== thread.id);
    // Only tear down the worktree when this is the last active chat tab.
    if (siblings.length === 0) {
      this.stopDev(thread.id);
      try {
        await runArchiveScript(thread.repoPath, thread.worktreePath, (line) => {
          this.emit({
            type: 'turn_output',
            threadId: thread.id,
            event: { type: 'stdout', data: `[archive] ${line}` },
          });
        });
      } catch {
        // Best-effort archive script
      }
      await removeWorktree(thread.repoPath, thread.worktreePath);
    }
    return setStatus(thread.id, 'archived');
  }

  async purge(threadRef: string, opts?: { deleteBranch?: boolean }): Promise<void> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id);
    if (isGlobalThread(thread)) {
      deleteThreadRecord(thread.id);
      return;
    }
    const siblings = threadsSharingWorktree(thread.worktreePath).filter((t) => t.id !== thread.id);
    if (siblings.length === 0) {
      this.stopDev(thread.id);
      try {
        await runArchiveScript(thread.repoPath, thread.worktreePath);
      } catch {
        // Best-effort
      }
      const { deleteBranchOnPurgeEnabled } = await import('../store/app-settings.js');
      const deleteBranch = opts?.deleteBranch ?? deleteBranchOnPurgeEnabled();
      await removeWorktree(thread.repoPath, thread.worktreePath, {
        deleteBranch: deleteBranch ? thread.branchName : undefined,
      });
    }
    deleteThreadRecord(thread.id);
  }

  async restore(threadRef: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    if (thread.status !== 'archived') {
      throw new Error('Thread is not archived');
    }
    if (isGlobalThread(thread)) {
      const { globalAgentCwd } = await import('../store/paths.js');
      updateThread(thread.id, { worktreePath: globalAgentCwd() });
      return setStatus(thread.id, 'idle');
    }
    if (!existsSync(thread.worktreePath)) {
      const { createThreadWorktree } = await import('../git/worktree.js');
      // Recreate worktree from existing branch
      const { execa } = await import('execa');
      const slug = thread.worktreePath.split('/').pop()!;
      const dest = thread.worktreePath;
      await execa('git', ['worktree', 'add', dest, thread.branchName], {
        cwd: thread.repoPath,
      });
      void createThreadWorktree;
      void slug;
    }
    return setStatus(thread.id, 'idle');
  }

  async attachCommand(threadRef: string) {
    const thread = this.requireThread(threadRef);
    const adapter = getAdapter(thread.agent);
    return adapter.buildAttach(thread);
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, Math.min(32, Math.floor(n)));
  }

  getRuntime(): OrchestratorRuntime {
    const threads = listThreads();
    const count = (status: Thread['status']) =>
      threads.filter((t) => t.status === status).length;
    return {
      running: this.runningCount,
      maxConcurrent: this.maxConcurrent,
      queued: count('queued'),
      idle: count('idle'),
      error: count('error'),
      stopped: count('stopped'),
      broken: count('broken'),
      totalActive: threads.length,
    };
  }

  private requireThread(ref: string): Thread {
    const thread = this.getThread(ref);
    if (!thread) throw new Error(`Thread not found: ${ref}`);
    return thread;
  }
}

let singleton: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
  if (!singleton) {
    singleton = new Orchestrator();
  }
  return singleton;
}

export async function startOrchestration(opts: {
  goal: string;
  agent: AgentKind;
  /** Omit or pass GLOBAL_WORKSPACE_ID for a home-less Global chat. */
  repoPath?: string;
  autonomy?: Thread['autonomy'];
  model?: string | null;
  effort?: Thread['effort'];
  fast?: boolean;
  planMode?: boolean;
  attachments?: Thread['attachments'];
}): Promise<Thread> {
  const repoPath = opts.repoPath?.trim();
  const goal = opts.goal.trim();
  const orch = getOrchestrator();

  // Default: Global workspace (no git home). Soccer-team nickname for the
  // sidebar title; goal stays on sourceRef and is also the first chat turn.
  if (!repoPath || isGlobalRepoPath(repoPath)) {
    const thread = createGlobalChat({
      sourceRef: goal,
      agent: opts.agent,
      autonomy: opts.autonomy,
      model: opts.model,
      effort: opts.effort,
      fast: opts.fast,
      planMode: opts.planMode,
      attachments: opts.attachments,
    });
    if (goal) {
      return orch.send(thread.id, goal);
    }
    return thread;
  }

  // Legacy: pinned-repo orchestration (real worktree). Prefer Global for new work.
  const { titleFromPrompt } = await import('../threads/title.js');
  const title = titleFromPrompt(goal) || 'Orchestration';
  const createOpts = {
    agent: opts.agent,
    repoPath,
    title,
    autonomy: opts.autonomy,
    model: opts.model,
    effort: opts.effort,
    fast: opts.fast,
    planMode: opts.planMode,
    attachments: opts.attachments,
  };
  const thread = await createThread({
    sourceType: 'branch',
    sourceRef: 'default',
    ...createOpts,
  }).catch(async () => {
    const { resolveDefaultBranch, resolveRepoRoot } = await import('../git/worktree.js');
    const repo = await resolveRepoRoot(repoPath);
    const def = await resolveDefaultBranch(repo);
    return createThread({
      sourceType: 'branch',
      sourceRef: def,
      ...createOpts,
      repoPath: repo,
    });
  });

  const { updateThread: upd } = await import('../store/thread-store.js');
  const updated = upd(thread.id, {
    sourceType: 'orchestration',
    sourceRef: goal,
  });
  if (goal) {
    return orch.send(updated.id, goal);
  }
  return updated;
}

