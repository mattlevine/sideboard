import { EventEmitter } from 'node:events';
import {
  formatSlackRepliesForTurn,
  pendingSlackExternalReplies,
} from '../slack/outbound-watch.js';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pushTurnStderr, summarizeTurnStderr, formatTurnExitError, fallbackTurnFailDetail, formatAgentErrorContinuePrompt, looksLikeAgentFailureMessage, looksLikeInvalidAgentSession, looksLikeV8Oom, shouldFeedErrorBackToAgent, shouldRetryCodexPluginIsolate, shouldRetryFailedAgentTurn, turnFailChatText } from '../agents/error-detail.js';
import { resolveGitDirsForLockRecovery } from '../git/run.js';
import { clearStaleIndexLocks } from '../git/stale-lock.js';
import { spawnAgentTurn, type SpawnTurnHandle } from '../agents/spawn.js';
import { traceTurn, withTimeout } from '../agents/turn-trace.js';
import { getAdapter } from '../agents/index.js';
import {
  connectedPrSelectors,
  getPrChecks,
  getPrDetails,
  getPrForHeadBranch,
  getPrMeta as fetchPrMeta,
  markPrReady as markGithubPrReady,
  mergePr as mergeGithubPr,
  removeWorktree,
  resolveGithubRepoSlug,
  resolvePrSelector,
} from '../git/worktree.js';
import { getPrStack as fetchPrStack } from '../git/stack.js';
import {
  AGENT_GIT_ACTIONS,
  expandCanonicalGitRequest,
  resolveSidebarGitPrompt,
  type AgentGitAction,
} from '../git/agent-git-actions.js';
import {
  normalizePrState,
  shouldAutoArchiveOnPrMerge,
  shouldPersistFetchedPrMeta,
  shouldStopRunOnPrRetarget,
  threadPrMetaPatch,
} from '../git/pr-merge-archive.js';
import {
  runWorkspaceSetup,
  startDevServer,
  runArchiveScript,
  listRunScripts,
  getRunMode,
  killListenersOnPorts,
} from '../hook/conductor.js';
import {
  appendSetupLog,
  beginSetupLog,
  finishSetupLog,
  readSetupLog,
  setupLogKeyForWorktree,
  type SetupLogSnapshot,
} from '../store/setup-log.js';
import {
  cleanupOrphanWorktrees,
  findOrphanWorktrees,
  shouldRunWorktreeCleanup,
} from '../git/orphan-cleanup.js';
import {
  cleanupArchivedHistory,
  shouldRunHistoryCleanup,
} from '../store/history-cleanup.js';
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
  RunScriptRequest,
  Thread,
  ThreadAttachment,
  ThreadOptionsPatch,
  TokenUsage,
  WorktreeDirtyStat,
} from '../types/thread.js';
import { isAdoptableRunScriptRequest } from '../types/thread.js';
import { clipAgentEventForPaint, isInternalAgentStatusText } from '../agents/message-parts.js';
import { sumUsageList } from '../agents/usage.js';
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
import { thisProcessShouldDrainAgentQueues } from '../store/desktop-host.js';
import {
  notifyParentOfChildHalt,
  shouldNotifyParentAfterTurnError,
} from './child-halt.js';
import {
  isJobContinuePrompt,
  listRunningDetachedJobs,
  planJobContinue,
  turnWatchedDetachedJob,
} from '../mcp/wait-for-job.js';
import { createThread } from '../threads/create.js';
import { resolveCreateFirstPrompt } from '../threads/implied-first-prompt.js';
import { isCowboyThread, isPrimaryCheckoutThread, shouldRemoveWorktreeOnTeardown } from '../threads/cowboy.js';
import { assertOrchestratorCapableAgent } from '../agents/orchestrator-capable.js';
import {
  createChatTab as createChatTabImpl,
  forkChatTab as forkChatTabImpl,
  normalizeWorktreePath,
  threadsSharingWorktree,
} from '../threads/chat-tabs.js';
import { enqueueByKey } from '../util/enqueue-by-key.js';
import { createLineCoalescer } from '../util/line-coalescer.js';
import { git } from '../git/run.js';
import { withRepoGitLock } from '../git/repo-git-lock.js';
import { clearTurnLive, noteTurnLiveEvent, readTurnLive } from '../store/turn-live.js';
import { shouldReadThreadToHealReconcile } from './reconcile-heal.js';
import {
  isStaleLastErrorDuringTurn,
  shouldStampSetupLastError,
} from './setup-last-error.js';
import { requestReview } from '../review/request-review.js';
import { forkThreadWorktree as forkThreadWorktreeImpl } from '../threads/fork-worktree.js';
import {
  isWorktreeRunProcessKey,
  mergeWorktreeActiveRuns,
  resolveWorktreeSetupLog,
  worktreeDevProcessKey,
  worktreeRunProcessKey,
  worktreeSetupProcessKey,
} from '../threads/worktree-runtime.js';
import {
  createQuotaFailoverChat,
  isolateQuotaFailover,
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
  getWorktreeDirtyStat,
  initializeGitRepository,
  listWorktreeFiles,
  readWorktreeFile,
  readWorktreeFileForUpload,
  statWorktreePath,
  writeWorktreeFile,
} from '../diff/diff.js';
import { discoverSkills, type SkillInfo } from '../skills/discover.js';
import { expandComposerPrompt } from '../composer/expand.js';
import {
  appendQueuedItem,
  consumeComposerAttachments,
  moveQueuedItemToFront,
  prependQueuedItem,
  removeQueuedItem,
  shiftQueuedItem,
  takePendingTurnAttachments,
} from '../composer/consume-attachments.js';
import {
  attachmentsFromWorktreePaths,
  stageAbsolutePathsAsAttachments,
  stageBuffersAsAttachments,
  type ComposerFileBuffer,
} from '../composer/stage-files.js';
import {
  buildBrightsySessionSeed,
  buildSessionSeed,
  maybeCompactContext,
} from '../composer/context-compact.js';
import {
  formatArtifactDirective,
  formatIssueToolsDirective,
  formatIssueToolsReminder,
  formatLongRunningDirective,
  formatLongRunningReminder,
  formatPrGateDirective,
  formatRenameBranchDirective,
  formatUiReminder,
  formatWorktreeDirective,
  formatWorktreeReminder,
  issueTicketFromThread,
  mentionsPrGoal,
} from '../agents/instructions.js';
import {
  formatReviewWriteGateDirective,
  formatReviewWriteGateReminder,
  isReviewWriteGatedThread,
} from '../review/review-write-gate.js';
import {
  formatOptionalServicesDirective,
  formatOptionalServicesReminder,
} from '../integrations/optional-services.js';
import {
  formatViewerContextDirective,
  formatViewerContextReminder,
  isAbleTimeConnected,
  isLinearConnected,
  followUpBehavior,
  loadAppSettings,
  resolveEffectiveIssueSource,
  resolveViewerProfileForRepo,
  type FollowUpBehavior,
} from '../store/app-settings.js';
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
import { releaseCaffeinateHoldForThread } from '../store/caffeinate-hold.js';
import { armSchedules } from './schedule-runner.js';
import {
  coordinatorSystemPrompt,
  coordinatorTurnReminder,
  enrichWorkspacesWithGithub,
  ensureGlobalCoordinatorCwd,
  SLACK_REPLY_FORMATTING,
} from './coordinator-prompt.js';

/** Status may be `running` for this long before `agentPid` is written. */
export const LIVE_TURN_SPAWN_GRACE_MS = 15_000;

/** MCP/CLI wait for desktop to adopt a run-script request (under the ~60s MCP kill). */
export const RUN_SCRIPT_DESKTOP_ADOPT_MS = 20_000;

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

/** Wait until pid exits, or `timeoutMs` elapses. */
export async function waitForPidExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (isPidAlive(pid)) {
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 80));
  }
  return true;
}

/**
 * Desktop/CLI pass follow-up explicitly. Internal sends (child-halt
 * "Sideboard: …" notices, Slack, schedules) omit it — orchestrators then
 * use Settings → Follow-up behavior (default steer) so those do not sit
 * in the queue while the user asked to interrupt.
 *
 * Orchestrator → worktree talk (`send_to_thread`, `ask_git`) must
 * pass {@link resolveOrchChildFollowUp} so those prompts steer by default.
 * Create/reuse first prompts still queue unless the caller opts in.
 */
export function resolveSendFollowUp(
  thread: Pick<Thread, 'sourceType' | 'repoPath'>,
  requested?: FollowUpBehavior,
): FollowUpBehavior {
  if (requested === 'steer' || requested === 'queue') return requested;
  return isOrchestratorThread(thread) ? followUpBehavior() : 'queue';
}

/** Settings follow-up for orchestrator prompts to worktree agents (default steer). */
export function resolveOrchChildFollowUp(
  requested?: FollowUpBehavior,
): FollowUpBehavior {
  if (requested === 'steer' || requested === 'queue') return requested;
  return followUpBehavior();
}

/** After Send now / Stop, do not pin drainQueue on a wedged agent child. */
const STALE_AGENT_PID_WAIT_MS = 2_500;

/** Creating several worktrees in a row runs one light reconcile per repo, not one each. */
export const LIGHT_RECONCILE_THROTTLE_MS = 10_000;

/** Persist status unless the thread was archived or purged mid-turn. */
function writeLiveStatus(
  threadId: string,
  status: Thread['status'],
  lastError?: string | null,
): Thread | null {
  const latest = readThread(threadId);
  if (!latest || latest.status === 'archived') return latest;
  return setStatus(threadId, status, lastError);
}

interface RegisteredProcess {
  kind: 'agent' | 'dev' | 'setup';
  pid?: number;
  startedAt: string;
  scriptName?: string;
  kill: () => void;
}

/** Ports recorded on ActiveRun (primary + SIDEBOARD_PORT_N range). */
function collectActiveRunPorts(runs: readonly ActiveRun[]): number[] {
  const ports = new Set<number>();
  for (const run of runs) {
    const list = run.ports?.length ? run.ports : run.port != null ? [run.port] : [];
    for (const p of list) {
      if (Number.isFinite(p) && p > 0) ports.add(p);
    }
  }
  return [...ports];
}

export class Orchestrator {
  readonly events = new EventEmitter();
  private readonly processes = new Map<string, RegisteredProcess>();
  private readonly activeTurns = new Map<string, SpawnTurnHandle>();
  private readonly draining = new Set<string>();
  /** Threads past setStatus(running) but not yet in activeTurns (spawn in flight). */
  private readonly startingTurns = new Set<string>();
  /** Last sync thread-file read for false-stop heal (throttled per thread). */
  private readonly lastReconcileHealAt = new Map<string, number>();
  /** Per-repo timestamp of the last `reconcile(repo, { light: true })`. */
  private readonly lightReconcileAt = new Map<string, number>();
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
  /**
   * Threads that already got a crash-continue turn. Cleared on a successful
   * finish or a user send so a later crash can recover again.
   */
  private readonly crashContinued = new Set<string>();
  /** Auto-continues after a worktree turn ended while a detached job still runs. */
  private readonly jobContinueCount = new Map<string, number>();
  private readonly jobContinueNudged = new Set<string>();
  /** In-flight startDev per worktree run key — agent MCP + UI Start must not double-spawn. */
  private readonly startingDev =
    new Map<string, Promise<{ port: number; scriptName: string; ports: number[] }>>();
  /** Serialize desktop apply of `runScriptRequest` per thread (start then stop). */
  private readonly applyingRunScriptThreads = new Set<string>();
  /**
   * MCP/CLI poll budget while Electron main adopts `runScriptRequest`.
   * Tests shorten this so a missing desktop does not wait 20s.
   */
  runScriptAdoptTimeoutMs = RUN_SCRIPT_DESKTOP_ADOPT_MS;
  private maxConcurrent: number;
  private runningCount = 0;

  constructor(opts?: { maxConcurrent?: number }) {
    this.maxConcurrent = opts?.maxConcurrent ?? 5;
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

  /**
   * Whether a child is actually turning — not leftover disk `running` after
   * the process died. Coordinators were telling users “Agent is running.
   * Waiting for gate to pass” from stale stillRunning.
   */
  threadLooksLive(thread: Pick<Thread, 'id' | 'status' | 'queue' | 'agentPid' | 'updatedAt'>): boolean {
    if (thread.status === 'queued') {
      if (this.draining.has(thread.id) || this.startingTurns.has(thread.id)) return true;
      return thread.queue.length > 0;
    }
    if (thread.status !== 'running') return false;
    if (this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id)) return true;
    const pid = thread.agentPid;
    if (typeof pid === 'number' && pid > 0 && isPidAlive(pid)) return true;
    const updated = Date.parse(thread.updatedAt ?? '');
    // Spawn window: status is running before agentPid is written.
    if (Number.isFinite(updated) && Date.now() - updated < LIVE_TURN_SPAWN_GRACE_MS) return true;
    return false;
  }

  /** Desktop-only: persist idle/stopped when MCP would otherwise keep reporting live. */
  private healStaleReportedActivity(thread: Thread): Thread {
    if (!thisProcessShouldDrainAgentQueues()) return thread;
    if (this.threadLooksLive(thread)) return thread;
    if (thread.status === 'running') {
      this.healStaleRunningTurns();
      return readThread(thread.id) ?? thread;
    }
    if (
      thread.status === 'queued' &&
      thread.queue.length === 0 &&
      !this.activeTurns.has(thread.id) &&
      !this.startingTurns.has(thread.id) &&
      !this.draining.has(thread.id)
    ) {
      setStatus(thread.id, 'idle');
      this.emit({ type: 'status_changed', threadId: thread.id, status: 'idle' });
      return readThread(thread.id) ?? thread;
    }
    return thread;
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
      /**
       * When false, skip draining persisted queues. MCP stdio boots must not
       * steal the whole fleet into a short-lived process (desktop adopts instead).
       * Default true for desktop/CLI.
       */
      drainQueues?: boolean;
      /**
       * Hot-path variant for "about to add a worktree to this repo": only the
       * repo-scoped checks (missing worktrees → broken, orphan discovery /
       * cleanup), throttled per repo. Skips the global heal loop, History
       * cleanup, queue adoption and timer re-arming — startup and the store
       * watcher own those. Requires `repoPath`.
       */
      light?: boolean;
    },
  ): Promise<void> {
    const reclaimStaleTurns = opts?.reclaimStaleTurns === true;
    const drainQueues = opts?.drainQueues !== false;

    if (opts?.light && repoPath) {
      const last = this.lightReconcileAt.get(repoPath) ?? 0;
      if (Date.now() - last < LIGHT_RECONCILE_THROTTLE_MS) return;
      this.lightReconcileAt.set(repoPath, Date.now());
      for (const thread of listThreads()) {
        if (isGlobalThread(thread) || thread.repoPath !== repoPath) continue;
        if (!existsSync(thread.worktreePath)) {
          setStatus(thread.id, 'broken', 'Worktree missing on disk');
          this.emit({ type: 'status_changed', threadId: thread.id, status: 'broken' });
        }
      }
      await this.reconcileOrphans([repoPath]);
      return;
    }

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

    // Detached run scripts outlive the Electron process. After restart the
    // in-memory handles are gone — free their ports and clear stale activeRuns
    // so Start / Stop work without a manual kill.
    if (reclaimStaleTurns) {
      this.reapOrphanedRunScripts();
    }

    const repoPaths = (
      repoPath
        ? [repoPath]
        : [...new Set(listThreads({ includeArchived: true }).map((t) => t.repoPath))]
    ).filter((p) => !isGlobalRepoPath(p));

    await this.reconcileOrphans(repoPaths);

    try {
      if (shouldRunHistoryCleanup()) {
        cleanupArchivedHistory();
      }
    } catch {
      // Best-effort History cap
    }

    if (drainQueues) {
      this.adoptPersistedQueues();
    }

    // Re-arm session-quota wait timers (and fire any that are already due).
    this.schedulePendingQuotaResumes();
    armSchedules();
  }

  /** Surface (and, when enabled, clean up) worktrees git knows about but no thread owns. */
  private async reconcileOrphans(repoPaths: string[]): Promise<void> {
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
  }

  /**
   * Adopt queues persisted by another process (MCP stdio / CLI) into this
   * orchestrator's drain loops. Desktop calls this on thread-store changes so
   * MCP-created review threads don't stay `queued` after the MCP child exits.
   */
  adoptPersistedQueues(): void {
    if (thisProcessShouldDrainAgentQueues()) {
      this.healStaleRunningTurns();
    }
    for (const thread of listThreads()) {
      if (thread.status === 'stopped' || thread.status === 'archived') continue;

      const pid = thread.agentPid;
      const deadPid =
        typeof pid === 'number' && pid > 0 && !isPidAlive(pid) ? true : false;
      if (deadPid) {
        updateThread(thread.id, { agentPid: null });
      }

      // Heal: prompt was popped then the draining process died before running.
      if (thread.status === 'queued' && thread.queue.length === 0) {
        if (!this.activeTurns.has(thread.id) && !this.startingTurns.has(thread.id)) {
          setStatus(thread.id, 'idle');
          this.emit({ type: 'status_changed', threadId: thread.id, status: 'idle' });
        }
        continue;
      }

      if (thread.queue.length > 0) {
        this.haltDrain.delete(thread.id);
        this.armDrain(thread.id);
      }
    }
    this.adoptPersistedRunScripts();
  }

  /**
   * Adopt run-script start/stop persisted by MCP/CLI while this process owns
   * live children (desktop host). Spawning in stdio leaves the Run tab on
   * "Starting…" with no logs — `run_output` never reaches the renderer.
   */
  adoptPersistedRunScripts(): void {
    if (!this.shouldOwnRunScripts()) return;
    for (const thread of listThreads()) {
      if (thread.status === 'archived') continue;
      const req = thread.runScriptRequest;
      if (!isAdoptableRunScriptRequest(req) || !req) continue;
      if (this.applyingRunScriptThreads.has(thread.id)) continue;
      const claimedAt = req.claimedAt ?? new Date().toISOString();
      const claimed: RunScriptRequest = { ...req, claimedAt };
      this.applyingRunScriptThreads.add(thread.id);
      updateThread(thread.id, { runScriptRequest: claimed });
      void this.applyRunScriptRequest(thread.id, claimed).finally(() => {
        this.applyingRunScriptThreads.delete(thread.id);
        const latest = readThread(thread.id)?.runScriptRequest;
        if (
          latest &&
          latest.requestId !== req.requestId &&
          isAdoptableRunScriptRequest(latest)
        ) {
          this.adoptPersistedRunScripts();
        }
      });
    }
  }

  private async applyRunScriptRequest(
    threadId: string,
    req: RunScriptRequest,
  ): Promise<void> {
    try {
      if (req.op === 'start') {
        await this.startDev(threadId, req.scriptName ?? undefined);
      } else {
        await this.stopDev(threadId, req.scriptName ?? undefined);
      }
      const latest = readThread(threadId);
      const current = latest?.runScriptRequest;
      if (current?.requestId === req.requestId && !current.error) {
        updateThread(threadId, {
          runScriptRequest: {
            ...current,
            fulfilledAt: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latest = readThread(threadId);
      const current = latest?.runScriptRequest;
      if (!current || current.requestId !== req.requestId) return;
      updateThread(threadId, {
        runScriptRequest: { ...current, error: message },
      });
    }
  }

  /**
   * Same rule as agent-queue drain: MCP stdio must not own Electron children
   * while Sideboard.app is alive.
   */
  shouldOwnRunScripts(): boolean {
    return thisProcessShouldDrainAgentQueues();
  }

  /**
   * Mid-session: a worktree can sit at `running` after the agent process dies
   * (Cursor/CLI crash, OOM) while wait_for_turn still reports stillRunning.
   * Reclaim those and wake the parent orchestration chat.
   */
  healStaleRunningTurns(): void {
    for (const thread of listThreads()) {
      if (thread.status === 'archived') continue;
      const handle = this.activeTurns.get(thread.id);
      if (handle) {
        // Only signal the handle we own. Disk `agentPid` can still be the
        // previous turn's dead pid for a beat after spawn — killing on that
        // would SIGTERM a live runner mid-thought.
        const pid = handle.pid;
        if (typeof pid === 'number' && pid > 0 && !isPidAlive(pid)) {
          handle.kill();
        }
        continue;
      }
      if (!this.shouldReclaimRunningThread(thread)) continue;
      setStatus(thread.id, 'stopped', 'Process died (agent exited)');
      this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
      this.emit({ type: 'turn_finished', threadId: thread.id, exitCode: 1 });
      const latest = readThread(thread.id);
      if (latest) {
        notifyParentOfChildHalt(latest, 'stopped', (id, prompt) => this.send(id, prompt));
      }
    }
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
   * Host-side continue when any chat hits a provider session/usage limit
   * (not context size): switch agent (Auto) or wait until reset.
   */
  private async maybeHandleOrchestrationQuotaFailover(
    threadId: string,
    limitText: string,
  ): Promise<boolean> {
    const thread = findThreadByRef(threadId);
    if (!thread) return false;
    const plan = planOrchestrationQuotaFailover(thread, limitText);
    if (!plan || plan.action === 'none') return false;

    if (plan.action === 'wait_reset' && plan.resumeAt) {
      // Don't keep draining prompts against the limited account.
      this.haltDrain.add(threadId);
      this.scheduleQuotaResume(threadId, plan.resumeAt);
      try {
        setStatus(threadId, 'idle', null);
        appendMessage(threadId, {
          role: 'agent',
          text: `Sideboard will auto-retry this chat around ${plan.resumeAt.toLocaleString()} when the session limit resets.`,
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
      } catch {
        // Wait is already scheduled — do not rethrow into runTurn.
      }
      return true;
    }

    if (plan.action === 'switch_agent' && plan.fallbackAgent) {
      this.haltDrain.add(threadId);
      let next: Thread;
      try {
        next = createQuotaFailoverChat(
          thread,
          plan.fallbackAgent,
          plan.limitText,
        );
      } catch {
        return false;
      }
      this.clearQuotaResumeTimer(threadId);
      try {
        updateThread(threadId, { quotaResumeAt: null });
      } catch {
        // ignore
      }
      try {
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
      } catch {
        // Sibling already exists — do not rethrow into runTurn.
      }
      // Do not await — turn cleanup must finish so the sibling can start.
      void this.send(
        next.id,
        QUOTA_CONTINUE_PROMPT(thread.agent, plan.fallbackAgent),
      );
      return true;
    }
    return false;
  }

  /**
   * Cursor-style recovery: after a runner crash, feed the error back as the
   * next prompt so the same agent can continue instead of sitting on lastError.
   */
  private maybeEnqueueCrashContinue(
    threadId: string,
    opts: { detail: string; assistantText: string; partsCount: number },
  ): void {
    if (this.crashContinued.has(threadId)) return;
    if (this.haltDrain.has(threadId)) return;
    if (
      !shouldFeedErrorBackToAgent({
        detail: opts.detail,
        assistantText: opts.assistantText,
        partsCount: opts.partsCount,
      })
    ) {
      return;
    }
    const thread = readThread(threadId);
    if (!thread || thread.status === 'archived') return;
    this.crashContinued.add(threadId);
    const prompt = formatAgentErrorContinuePrompt(opts.detail);
    const next = prependQueuedItem(thread.queue, thread.queueAttachments, prompt);
    updateThread(threadId, next);
    this.emit({ type: 'queue_changed', threadId, queue: next.queue });
    this.haltDrain.delete(threadId);
  }

  /**
   * Worktree agent ended the turn after “I’ll let you know” (or left a
   * detached test/pack job running). Queue a continue so the chat does not
   * go idle with nobody watching the log.
   */
  private maybeEnqueueJobContinue(
    threadId: string,
    chatText: string,
    parts: { type?: string; name?: string; detail?: string; description?: string; input?: unknown }[] = [],
  ): void {
    if (this.haltDrain.has(threadId)) return;
    const thread = readThread(threadId);
    if (!thread || thread.status === 'archived') return;
    const runningJobIds = listRunningDetachedJobs(thread.worktreePath ?? '');
    const decision = planJobContinue({
      runningJobIds,
      chatText,
      queueLength: thread.queue.length,
      continueCount: this.jobContinueCount.get(threadId) ?? 0,
      alreadyNudged: this.jobContinueNudged.has(threadId),
      isOrchestrator: isOrchestratorThread(thread),
      agent: thread.agent,
      watchedJob: turnWatchedDetachedJob(parts),
    });
    if (decision.action === 'none') {
      if (runningJobIds.length === 0) this.jobContinueCount.delete(threadId);
      return;
    }
    if (decision.action === 'nudge') this.jobContinueNudged.add(threadId);
    else this.jobContinueCount.set(threadId, (this.jobContinueCount.get(threadId) ?? 0) + 1);
    const next = prependQueuedItem(thread.queue, thread.queueAttachments, decision.prompt);
    updateThread(threadId, next);
    this.emit({ type: 'queue_changed', threadId, queue: next.queue });
    this.haltDrain.delete(threadId);
  }

  getThreads(includeArchived = false): Thread[] {
    return listThreads({ includeArchived });
  }

  getThread(idOrRef: string): Thread | null {
    // Exact id first: one stat + cache hit. `findThreadByRef` lists every
    // record including archived (readdir + stat per file) — reserve it for
    // prefixes, branch names and titles.
    return readThread(idOrRef) ?? findThreadByRef(idOrRef);
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    const prior = new Set(
      listThreads({ includeArchived: false }).map((t) => t.id),
    );
    const thread = await createThread(input);
    const reused = prior.has(thread.id);
    const prompt = resolveCreateFirstPrompt({
      sourceType: input.sourceType,
      prompt: input.prompt,
      parentThreadId: input.parentThreadId ?? thread.parentThreadId,
      reused,
      hasUserMessages: thread.messages.some((m) => m.role === 'user'),
    });
    if (reused) {
      if (prompt) {
        try {
          await this.send(thread.id, prompt);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateThread(thread.id, {
            lastError: `First prompt failed: ${message}`,
          });
        }
      }
      return thread;
    }
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });

    // Return as soon as the worktree exists so the chat UI can open. Setup
    // runs in the background in parallel with the first prompt.
    void this.finishCreateThread(thread.id, prompt);

    return thread;
  }

  private async finishCreateThread(
    threadId: string,
    prompt?: string,
  ): Promise<void> {
    const created = this.getThread(threadId);
    const skipSetup = isCowboyThread(created);
    const setup = skipSetup ? Promise.resolve() : this.runSetupAfterCreate(threadId);

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

    await setup;

    if (skipSetup) return;

    const { autoRunAfterSetupEnabled } = await import('../store/app-settings.js');
    if (autoRunAfterSetupEnabled()) {
      try {
        await this.startDev(threadId);
      } catch {
        // Best-effort — setup/run script may be missing.
      }
    }
  }

  /** Run workspace setup after a new worktree is created (no-op if none configured). */
  private async runSetupAfterCreate(threadId: string): Promise<void> {
    try {
      // Failures stay in the Setup panel. Stamping lastError here paints a red
      // error on a brand-new chat tab — especially when many worktrees start
      // at once and install scripts race before the first prompt is sent.
      await this.runSetup(threadId, { stampLastError: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/no setup script/i.test(message)) return;
      if (/already running/i.test(message)) return;
    }
  }

  listWorkspaces(): Workspace[] {
    // Keep projects visible after their last worktree is archived. Explicit
    // removals stay dismissed via removed-workspaces.json.
    const fromThreads = listThreads({ includeArchived: true }).map((t) => t.repoPath);
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

  async send(
    threadRef: string,
    prompt: string,
    opts?: { followUp?: FollowUpBehavior },
  ): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    if (thread.status === 'archived') {
      throw new Error(`Thread is archived: ${thread.id}`);
    }
    let shouldSteer = false;
    const sent = await withThreadLock(thread.id, async () => {
      const current = this.requireThread(thread.id);
      if (current.status === 'archived') {
        throw new Error(`Thread is archived: ${thread.id}`);
      }
      const followUp = resolveSendFollowUp(current, opts?.followUp);
      const consumed = consumeComposerAttachments(current);
      const queued = appendQueuedItem(
        current.queue,
        current.queueAttachments,
        prompt,
        consumed.consumed,
      );
      this.crashContinued.delete(thread.id);
      this.jobContinueCount.delete(thread.id);
      this.jobContinueNudged.delete(thread.id);
      this.haltDrain.delete(thread.id);
      const inFlight =
        this.activeTurns.has(thread.id) ||
        this.startingTurns.has(thread.id) ||
        current.status === 'running';
      // Skip the inbox (in-flight turn or already-parked follow-ups).
      shouldSteer = followUp === 'steer' && (inFlight || current.queue.length > 0);
      const patch: Parameters<typeof updateThread>[1] = queued;
      if (consumed.consumed.length > 0) {
        patch.attachments = consumed.attachments;
      }
      if (!inFlight) patch.status = 'queued';
      // Stale agentPid from a dead MCP/desktop child can pin drainQueue forever.
      const pid = current.agentPid;
      if (typeof pid === 'number' && pid > 0 && !isPidAlive(pid)) {
        patch.agentPid = null;
      }
      updateThread(thread.id, patch);
      this.emit({ type: 'queue_changed', threadId: thread.id, queue: queued.queue });
      if (!inFlight) {
        this.emit({ type: 'status_changed', threadId: thread.id, status: 'queued' });
      }
      // MCP/CLI enqueue only while the board is alive — otherwise the turn
      // runs in a stdio child with no renderer IPC (blank worktree chat).
      // Steer promotes via sendQueuedMessageNow after the lock.
      if (thisProcessShouldDrainAgentQueues() && !shouldSteer) {
        this.armDrain(thread.id);
      }
      return this.requireThread(thread.id);
    });
    if (shouldSteer && sent.queue.length > 0) {
      return this.sendQueuedMessageNow(sent.id, sent.queue.length - 1);
    }
    return sent;
  }

  async fanOut(
    threadRefs: string[],
    prompt: string,
    opts?: { followUp?: FollowUpBehavior },
  ): Promise<Thread[]> {
    const results: Thread[] = [];
    for (const ref of threadRefs) {
      results.push(await this.send(ref, prompt, opts));
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
      const removed = removeQueuedItem(current.queue, current.queueAttachments, index);
      const stillQueued = removed.queue.length > 0;
      const inFlight = this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id);
      updateThread(thread.id, {
        ...removed,
        // Follow-up files live on queueAttachments. pendingTurnAttachments is
        // the in-flight / just-dequeued snapshot — do not wipe it when a
        // later follow-up is removed. Only drop a leftover bag when nothing
        // is running and the queue is empty (legacy sends that never drained).
        ...(stillQueued || inFlight ? {} : { pendingTurnAttachments: [] }),
        status: !stillQueued && !inFlight && current.status === 'queued' ? 'idle' : current.status,
      });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue: removed.queue });
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
      const next = moveQueuedItemToFront(current.queue, current.queueAttachments, index);
      this.haltDrain.delete(thread.id);
      updateThread(thread.id, next);
      this.emit({ type: 'queue_changed', threadId: thread.id, queue: next.queue });
      return true;
    });
    if (!promoted) return this.requireThread(thread.id);
    // MCP/CLI while the board is alive: the in-flight child belongs to the
    // desktop. Killing it by agentPid reads as a crash there (retry / error
    // continue), and draining here spawns the next turn in a stdio process
    // with no renderer IPC. Leave the promoted prompt at the front — the
    // desktop drain loop runs it as soon as the current turn unwinds.
    if (!thisProcessShouldDrainAgentQueues()) return this.requireThread(thread.id);
    const current = this.requireThread(thread.id);
    const inFlight = this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id);
    const livePid = current.agentPid;
    const foreignLive =
      !inFlight &&
      typeof livePid === 'number' &&
      livePid > 0 &&
      isPidAlive(livePid);
    if (inFlight || foreignLive) {
      this.stop(thread.id, { clearQueue: false, continueQueue: true });
    }
    // Always arm drain. If a loop is already waiting on the dying child, this
    // is a no-op; if Stop left no drain running, Send now must start one.
    this.armDrain(thread.id);
    return this.requireThread(thread.id);
  }

  private armDrain(threadId: string): void {
    void this.drainQueue(threadId).catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[sideboard] drainQueue ${threadId}: ${detail}`);
    });
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
        if (!thread || thread.status === 'archived' || thread.queue.length === 0) {
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
        // Cap the wait: a wedged Cursor runner after SIGTERM used to pin Send now
        // until the user clicked again (second click was a no-op while draining).
        const livePid = thread.agentPid;
        if (typeof livePid === 'number' && livePid > 0 && isPidAlive(livePid)) {
          const exited = await waitForPidExit(livePid, STALE_AGENT_PID_WAIT_MS);
          if (!exited && isPidAlive(livePid)) {
            try {
              process.kill(livePid, 'SIGKILL');
            } catch {
              // ignore
            }
            await waitForPidExit(livePid, 400);
            try {
              updateThread(threadId, { agentPid: null });
            } catch {
              // Thread may have been archived.
            }
          }
          continue;
        }

        const shifted = shiftQueuedItem(thread.queue, thread.queueAttachments);
        if (!shifted) break;
        updateThread(threadId, {
          queue: shifted.queue,
          queueAttachments: shifted.queueAttachments,
          // Always write the snapshot, including [] for text-only, so
          // takePending cannot fall back to leftover pending or composer files.
          pendingTurnAttachments: shifted.attachments,
        });
        this.emit({ type: 'queue_changed', threadId, queue: shifted.queue });
        await this.runTurn(threadId, shifted.prompt);
      }
    } finally {
      this.draining.delete(threadId);
    }
  }

  private async runTurn(threadId: string, prompt: string): Promise<void> {
    const existing = readThread(threadId);
    if (!existing || existing.status === 'archived') return;
    let thread = existing;
    // Drop Claude --resume when a Global chat previously acted like a worktree coder
    // (Bash on synthetic home, no Sideboard MCP) so identity prompts can re-seed.
    if (
      isGlobalThread(thread) &&
      thread.sessionId &&
      orchestratorSessionPoisonedByBuiltins(thread)
    ) {
      thread = updateThread(threadId, { sessionId: null });
    }
    const running = writeLiveStatus(threadId, 'running');
    if (!running || running.status !== 'running') return;
    this.runningCount += 1;
    const turnStartedAt = Date.now();
    // Mark before setStatus so concurrent reconcile (or MCP) won't reclaim us.
    this.startingTurns.add(threadId);
    this.emit({ type: 'status_changed', threadId, status: 'running' });
    this.emit({ type: 'turn_started', threadId, prompt });

    try {
    // Pre-spawn work (queue shape, git slug, directives) used to sit outside
    // this try/finally. A throw there left startingTurns set forever, so
    // later worktree sends spun in drainQueue and never spawned Claude.
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
          sessionId: compact.thread.sessionId,
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

    const promptText = typeof prompt === 'string' ? prompt : '';
    const autoContinue =
      isJobContinuePrompt(promptText) ||
      promptText.startsWith('The previous agent process ended before it finished.');
    const parked = takePendingTurnAttachments(thread);
    const sentAttachments = !autoContinue && parked.length > 0 ? parked : undefined;
    appendMessage(threadId, {
      role: 'user',
      text: promptText,
      ...(sentAttachments ? { attachments: sentAttachments } : {}),
      ...(autoContinue ? { origin: 'continue' as const } : {}),
      ts: new Date().toISOString(),
    });
    traceTurn('runTurn.afterUserMessage', {
      threadId,
      agent: thread.agent,
      orch: isOrchestratorThread(thread),
    });

    thread = this.requireThread(threadId);
    // Git-button phrases and PR-goal detection must see the raw user text.
    // Composer expansion appends attachments / @files / skills and would
    // both miss exact phrases and false-trigger on skill/file mentions of CI.
    const gitPrompt = expandCanonicalGitRequest(promptText);
    const { agentPrompt: expandedPrompt } = expandComposerPrompt(
      thread.worktreePath,
      gitPrompt,
      {
        attachments: autoContinue ? [] : (sentAttachments ?? []),
      },
    );
    // Re-assert on every turn (incl. Claude --resume, which drops cachedPrefix).
    // Sideboard plan mode stays on until the user toggles it off / Implement.
    // Orchestrators get a short identity reminder the same way — resume strips
    // the full playbook from cachedPrefix.
    const slackInbound = /^(Slack DM|Slack @mention)(?:\n|$)/.test(
      expandedPrompt.trim(),
    );
    const orchestrationReminder = isOrchestratorThread(thread)
      ? [
          coordinatorTurnReminder({
            parentId: threadId,
            goal: thread.sourceRef || thread.title,
          }),
          slackInbound
            ? [
                'This turn is a Slack DM or @mention. Your reply is posted back in Slack — keep it concise. Sideboard signs it with this Mac\'s destination name; do not prefix the name yourself.',
                SLACK_REPLY_FORMATTING,
              ].join('\n')
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null;
    // Re-assert on every turn (incl. CLI --resume, which drops cachedPrefix).
    const artifactReminder =
      thread.agent !== 'brightsy' ? formatUiReminder() : null;
    const longRunningReminder =
      thread.agent !== 'brightsy' && !isOrchestratorThread(thread)
        ? formatLongRunningReminder()
        : null;
    const worktreeReminder =
      thread.agent !== 'brightsy' && !isOrchestratorThread(thread)
        ? formatWorktreeReminder()
        : null;
    const optionalServicesReminder =
      thread.agent !== 'brightsy' && !isOrchestratorThread(thread)
        ? formatOptionalServicesReminder(loadAppSettings().integrations)
        : null;
    const issueTicket = issueTicketFromThread(thread, resolveEffectiveIssueSource());
    const issueToolsReminder =
      thread.agent !== 'brightsy' && !isOrchestratorThread(thread)
        ? formatIssueToolsReminder({
            linear: isLinearConnected(),
            abletime: isAbleTimeConnected(),
            github: true,
            ticketId: issueTicket?.id,
            ticketProvider: issueTicket?.provider,
          })
        : null;
    const viewerContextReminder =
      thread.agent !== 'brightsy' && !isOrchestratorThread(thread)
        ? formatViewerContextReminder()
        : null;
    const reviewWriteGateReminder =
      thread.agent !== 'brightsy' &&
      !isOrchestratorThread(thread) &&
      isReviewWriteGatedThread(
        thread,
        thread.worktreePath ? threadsSharingWorktree(thread.worktreePath) : [],
      )
        ? formatReviewWriteGateReminder()
        : null;
    const slackReplyContext = formatSlackRepliesForTurn(
      pendingSlackExternalReplies(thread.messages),
    );
    // Standing reminders restate the fresh-session directives. They travel as
    // `systemPrompt`: Claude appends them to its (cached) system prompt; other
    // CLIs prepend them only on resumed turns (fresh turns have the directives).
    const turnReminders =
      [
        worktreeReminder,
        optionalServicesReminder,
        issueToolsReminder,
        reviewWriteGateReminder,
        viewerContextReminder,
        artifactReminder,
        longRunningReminder,
      ]
        .filter(Boolean)
        .join('\n\n') || undefined;
    // Goal-scoped playbook (Greptile 5/5, CI green) only when this request names one.
    const prGateDirective =
      thread.agent !== 'brightsy' &&
      !isOrchestratorThread(thread) &&
      mentionsPrGoal(promptText)
        ? formatPrGateDirective()
        : null;
    const agentPrompt = [
      thread.planMode ? PLAN_MODE_INSTRUCTION : null,
      orchestrationReminder,
      prGateDirective,
      slackReplyContext,
      expandedPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');
    // Drop only the snapshot this turn sent. Composer files dropped after
    // send() stay for the next message.
    if (!autoContinue && sentAttachments) {
      updateThread(threadId, { pendingTurnAttachments: [] });
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
    const { autoRenameBranchEnabled, getGithubGitAuthMode, gitBranchPrefixSetting } =
      await import('../store/app-settings.js');
    const gitAuthMode = getGithubGitAuthMode();
    // Orchestrators use Sideboard MCP across registered repos — not a single worktree PR playbook.
    const worktreeDirective =
      isBrightsy || isOrchestration
        ? null
        : formatWorktreeDirective(fresh, {
            githubSlug: await withTimeout(
              resolveGithubRepoSlug(fresh.worktreePath),
              8_000,
              'resolveGithubRepoSlug',
            ).catch(() => null),
            gitAuthMode,
          });
    const artifactDirective = isBrightsy ? null : formatArtifactDirective();
    const longRunningDirective =
      isBrightsy || isOrchestration ? null : formatLongRunningDirective();
    const optionalServicesDirective =
      isBrightsy || isOrchestration
        ? null
        : formatOptionalServicesDirective(loadAppSettings().integrations);
    const freshIssueTicket = issueTicketFromThread(fresh, resolveEffectiveIssueSource());
    const issueToolsDirective =
      isBrightsy || isOrchestration
        ? null
        : formatIssueToolsDirective({
            linear: isLinearConnected(),
            abletime: isAbleTimeConnected(),
            github: true,
            ticketId: freshIssueTicket?.id,
            ticketProvider: freshIssueTicket?.provider,
          });
    const reviewWriteGateDirective =
      isBrightsy ||
      isOrchestration ||
      !isReviewWriteGatedThread(
        fresh,
        fresh.worktreePath ? threadsSharingWorktree(fresh.worktreePath) : [],
      )
        ? null
        : formatReviewWriteGateDirective();
    let viewerContextDirective: string | null = null;
    if (!isBrightsy && !isOrchestration) {
      try {
        viewerContextDirective = formatViewerContextDirective(
          resolveViewerProfileForRepo(fresh.repoPath || fresh.worktreePath),
        );
      } catch {
        viewerContextDirective = formatViewerContextDirective(
          resolveViewerProfileForRepo(),
        );
      }
    }
    const settings = loadWorkspaceSettings(fresh.worktreePath, fresh.repoPath);
    let renameBranchDirective: string | null = null;
    if (!isBrightsy && !isOrchestration && autoRenameBranchEnabled()) {
      const { resolveGitBranchPrefix } = await import('../git/branch-prefix.js');
      renameBranchDirective = formatRenameBranchDirective(fresh, {
        customPrompt: settings?.prompts?.renameBranch,
        branchPrefix: resolveGitBranchPrefix({
          setting: gitBranchPrefixSetting(),
        }),
      });
    }
    // CLIs auto-load CLAUDE.md / AGENTS.md from the worktree — do not duplicate
    // them in the user message. Brightsy carries its own server-side instructions.
    // Fresh / compacted sessions have no CLI resume — seed from Sideboard history.
    let seed: string | null = null;
    if (!fresh.sessionId) {
      const prior = fresh.messages.slice(0, -1);
      // Brightsy has no session resume. Window from the last successful
      // `summarize_context` tool (not Sideboard `role: 'summary'`), then every
      // later turn — text-only so other tool dumps empty-complete. No last-N cap.
      seed = isBrightsy ? buildBrightsySessionSeed(prior) : buildSessionSeed(prior);
    }

    // Fresh orchestration sessions get audience + workspace inventory.
    // Fleet playbook is AGENTS.md / CLAUDE.md in the global cwd (same body).
    // Every turn also gets coordinatorTurnReminder in agentPrompt.
    let coordinatorDirective: string | null = null;
    if (isOrchestration) {
      if (isGlobalThread(fresh)) {
        ensureGlobalCoordinatorCwd({ orchestratorThreadId: fresh.id });
      }
      if (!fresh.sessionId) {
        const inventory = await enrichWorkspacesWithGithub(this.listWorkspaces());
        coordinatorDirective = coordinatorSystemPrompt({
          goal: fresh.sourceRef || fresh.title || 'Orchestration',
          parentId: fresh.id,
          workspaces: inventory,
          audience: /^(Slack DM|Slack @mention)(?:\n|$)/.test(
            expandedPrompt.trim(),
          )
            ? 'slack'
            : 'desktop',
        });
      }
    }

    // Worktree / artifact playbooks only on a fresh session. Resumed CLI sessions
    // already have them; adapters also drop cachedPrefix on resume.
    const cachedPrefix = fresh.sessionId
      ? ''
      : [
          coordinatorDirective,
          worktreeDirective,
          optionalServicesDirective,
          issueToolsDirective,
          reviewWriteGateDirective,
          viewerContextDirective,
          artifactDirective,
          longRunningDirective,
          renameBranchDirective,
          seed,
        ]
          .filter(Boolean)
          .join('\n\n---\n\n');

      const stderrTail: string[] = [];
      traceTurn('runTurn.beforeSpawn', { threadId, agent: fresh.agent });
      const handle = await spawnAgentTurn(
        fresh,
        {
          cachedPrefix,
          prompt: agentPrompt,
          systemPrompt: turnReminders,
          isolateCodexPlugins: fresh.isolateCodexPlugins === true,
        },
        (event) => {
          const paint = clipAgentEventForPaint(event);
          this.emit({ type: 'turn_output', threadId, event: paint });
          noteTurnLiveEvent(threadId, paint);
          if (event.type === 'session_id') {
            updateThread(threadId, { sessionId: event.data });
          }
          if (event.type === 'stderr' && typeof event.data === 'string') {
            pushTurnStderr(stderrTail, event.data);
          }
          // Heal stale lastError (reconcile-on-startup, setup exit) while we
          // still own the turn. Skip high-frequency frames — full thread reads
          // on every tool_result/stderr stall Electron navigation.
          const now = Date.now();
          if (
            shouldReadThreadToHealReconcile(
              event.type,
              this.lastReconcileHealAt.get(threadId),
              now,
            )
          ) {
            this.lastReconcileHealAt.set(threadId, now);
            const live = readThread(threadId);
            // Cursor's slower spawn already wipes lastError at spawn-complete
            // (setup often finished by then). Claude is already in tool_use,
            // so also clear setup / reconcile stamps on later tool events.
            if (
              isStaleLastErrorDuringTurn(live?.lastError) &&
              (this.activeTurns.has(threadId) || this.startingTurns.has(threadId))
            ) {
              setStatus(threadId, 'running');
              this.emit({ type: 'status_changed', threadId, status: 'running' });
            }
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
      // Skip on Send now / Stop — waiting here delays the next queued prompt by up to 4s.
      if (
        !this.stoppedTurns.has(threadId) &&
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
              threadId,
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

      // Claude / Codex / OpenCode / Cursor: stale resume ids, corrupt Cursor
      // JSONL checkpoints, a dead Node runner, or V8 heap OOM with an existing
      // session. Drop the session and retry once with a seeded fresh CLI
      // session (cursor-runner also recovers checkpoints in-process). Homebrew
      // Current may die again on the retry; first-turn indexing OOM (no
      // session) is not retried. Then lastError reaches the orchestrator.
      // Codex plugin/App MCP (PostHog OAuth) is process-fatal — trap it by
      // isolating Apps/plugins and retrying the same prompt so work continues.
      const liveThread = this.requireThread(threadId);
      const isolateCodexPluginRetry =
        liveThread.agent === 'codex' &&
        shouldRetryCodexPluginIsolate(detail, {
          // Coordinators already pass toCodexUnattendedAppsArgs — a second
          // isolate exec keeps sessionId and burns the crash/OOM retry.
          alreadyIsolated:
            liveThread.isolateCodexPlugins === true ||
            isOrchestratorThread(liveThread),
        });
      if (isolateCodexPluginRetry) {
        updateThread(threadId, { isolateCodexPlugins: true });
      }
      if (
        exitCode !== 0 &&
        !assistantText &&
        parts.length === 0 &&
        !this.stoppedTurns.has(threadId) &&
        (isolateCodexPluginRetry ||
          shouldRetryFailedAgentTurn(detail, {
            hasSession: Boolean(this.requireThread(threadId).sessionId),
          }))
      ) {
        if (!isolateCodexPluginRetry) {
          updateThread(threadId, { sessionId: null });
        }
        // A dead git child (e.g. a commit killed mid-write by the same OOM/crash)
        // can leave index.lock behind, which blocks every further git command —
        // Sideboard's own actions and the user's own terminal git alike. We just
        // confirmed this turn's process is gone, so clear it now instead of
        // waiting on the generic staleness timeout in git/run.ts.
        try {
          const gitDirs = await resolveGitDirsForLockRecovery(thread.worktreePath);
          const clearedLocks = clearStaleIndexLocks(gitDirs, 2_000);
          if (clearedLocks.length > 0) {
            pushTurnStderr(stderrTail, 'Cleared a stale git lock left by the crashed agent process');
          }
        } catch {
          // Best-effort — a real git repo check will surface any remaining lock.
        }
        const retryNote = isolateCodexPluginRetry
          ? 'Codex plugin/MCP failed — continuing without that vendor plugin (Settings → Connectors + HTTP API)'
          : looksLikeInvalidAgentSession(detail)
            ? 'Agent session missing — starting a fresh session'
            : looksLikeV8Oom(detail)
              ? 'Agent ran out of memory — starting a fresh session'
              : 'Agent runner crashed — restarting Node once';
        pushTurnStderr(stderrTail, retryNote);
        this.emit({
          type: 'turn_output',
          threadId,
          event: { type: 'stderr', data: retryNote },
        });
        const retryThread = this.requireThread(threadId);
        const prior = retryThread.messages.slice(0, -1);
        const retrySeed = isBrightsy
          ? buildBrightsySessionSeed(prior)
          : buildSessionSeed(prior);
        const retryPrefix = [
          coordinatorDirective,
          worktreeDirective,
          optionalServicesDirective,
          issueToolsDirective,
          reviewWriteGateDirective,
          viewerContextDirective,
          artifactDirective,
          longRunningDirective,
          renameBranchDirective,
          retrySeed,
        ]
          .filter(Boolean)
          .join('\n\n---\n\n');
        const retryHandle = await spawnAgentTurn(
          retryThread,
          {
            cachedPrefix: retryPrefix,
            prompt: agentPrompt,
            systemPrompt: turnReminders,
            isolateCodexPlugins:
              isolateCodexPluginRetry || retryThread.isolateCodexPlugins === true,
          },
          (event) => {
            const paint = clipAgentEventForPaint(event);
            this.emit({ type: 'turn_output', threadId, event: paint });
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

      // Put runner crashes / CLI failures with no assistant text in the agent
      // bubble so wait_for_turn and a later retry can plan around them.
      let chatText = this.stoppedTurns.has(threadId)
        ? assistantText
        : turnFailChatText({ exitCode, assistantText, detail });
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
      const afterTurn = readThread(threadId);
      if (afterTurn && afterTurn.status !== 'archived' && afterTurn.planMode && afterTurn.worktreePath?.trim()) {
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
        afterTurn &&
        afterTurn.status !== 'archived' &&
        afterTurn.planMode &&
        afterTurn.agent === 'claude' &&
        parts.some(
          (p) => p.type === 'tool' && /exitplanmode/i.test(p.name),
        )
      ) {
        updateThread(threadId, { sessionId: null });
      }
      // Pick up agent `git branch -m` renames for sidebar labels.
      // Send now / Stop must not wait on git before drain starts the next prompt.
      if (this.stoppedTurns.has(threadId)) {
        void syncThreadBranchFromGit(threadId).catch(() => undefined);
      } else {
        await syncThreadBranchFromGit(threadId);
      }
      if (this.stoppedTurns.has(threadId)) {
        // Preserve intentional stop — do not overwrite with idle/error from kill exit.
        const stopped = writeLiveStatus(threadId, 'stopped');
        if (stopped?.status === 'stopped') {
          this.emit({ type: 'status_changed', threadId, status: 'stopped' });
        }
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
        const nextStatus = exitCode === 0 ? 'idle' : 'error';
        const written = writeLiveStatus(
          threadId,
          nextStatus,
          exitCode === 0 || explainedInChat ? null : failDetail,
        );
        if (written && written.status !== 'archived') {
          this.emit({
            type: 'status_changed',
            threadId,
            status: written.status,
          });
        }
        this.emit({ type: 'turn_finished', threadId, exitCode });
        if (exitCode === 0) {
          this.crashContinued.delete(threadId);
          this.maybeEnqueueJobContinue(threadId, chatText, parts);
        } else {
          const blob = [chatText, detail].filter(Boolean).join('\n');
          const failedOver = await isolateQuotaFailover(() =>
            this.maybeHandleOrchestrationQuotaFailover(threadId, blob),
          );
          this.maybeEnqueueCrashContinue(threadId, {
            detail: detail || failDetail,
            assistantText: chatText,
            partsCount: parts.length,
          });
          if (
            shouldNotifyParentAfterTurnError({
              quotaFailoverHandled: failedOver,
              crashContinued: this.crashContinued.has(threadId),
            })
          ) {
            const failed = readThread(threadId);
            if (failed) {
              notifyParentOfChildHalt(failed, 'error', (id, prompt) => this.send(id, prompt));
            }
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await syncThreadBranchFromGit(threadId).catch(() => undefined);
      if (this.stoppedTurns.has(threadId)) {
        const stopped = writeLiveStatus(threadId, 'stopped');
        if (stopped?.status === 'stopped') {
          this.emit({ type: 'status_changed', threadId, status: 'stopped' });
        }
        this.emit({ type: 'turn_finished', threadId, exitCode: 1 });
      } else {
        const written = writeLiveStatus(threadId, 'error', message);
        if (written?.status === 'error') {
          this.emit({ type: 'error', threadId, message });
          this.emit({ type: 'status_changed', threadId, status: 'error' });
        }
        this.emit({ type: 'turn_finished', threadId, exitCode: 1 });
        const failedOver = await isolateQuotaFailover(() =>
          this.maybeHandleOrchestrationQuotaFailover(threadId, message),
        );
        this.maybeEnqueueCrashContinue(threadId, {
          detail: message,
          assistantText: '',
          partsCount: 0,
        });
        if (
          shouldNotifyParentAfterTurnError({
            quotaFailoverHandled: failedOver,
            crashContinued: this.crashContinued.has(threadId),
          })
        ) {
          const failed = readThread(threadId);
          if (failed) {
            notifyParentOfChildHalt(failed, 'error', (id, prompt) => this.send(id, prompt));
          }
        }
      }
    } finally {
      this.startingTurns.delete(threadId);
      this.activeTurns.delete(threadId);
      this.processes.delete(`${threadId}:agent`);
      this.stoppedTurns.delete(threadId);
      this.runningCount = Math.max(0, this.runningCount - 1);
      clearTurnLive(threadId);
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
    opts?: { clearQueue?: boolean; continueQueue?: boolean; notifyParent?: boolean },
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
      updateThread(thread.id, { queue: [], queueAttachments: [] });
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
    const pid = thread.agentPid;
    if (typeof pid === 'number' && pid > 0 && isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already signaled via handle, or the process exited.
      }
    }
    const stopped = writeLiveStatus(thread.id, 'stopped') ?? readThread(thread.id) ?? thread;
    if (stopped.status === 'stopped') {
      this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
      // Idle stop (archive, leftover status) is not a mid-turn death.
      // MCP force_stop / stop_thread pass notifyParent: false — the caller already knows.
      if (inFlight && opts?.notifyParent !== false) {
        notifyParentOfChildHalt(stopped, 'stopped', (id, prompt) => this.send(id, prompt));
      }
    }
    return stopped;
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

    if (!this.shouldOwnRunScripts()) {
      const result = await this.requestDesktopRunScript(thread, 'start', resolvedName);
      if (!result) {
        throw new Error('Desktop did not return a run script port.');
      }
      return result;
    }

    const runKey = worktreeRunProcessKey(thread.worktreePath, resolvedName);
    const inFlight = this.startingDev.get(runKey);
    if (inFlight) return inFlight;

    const start = this.startDevUnlocked(thread, resolvedName, scriptName, scripts, runKey);
    this.startingDev.set(runKey, start);
    try {
      return await start;
    } finally {
      this.startingDev.delete(runKey);
    }
  }

  private async startDevUnlocked(
    thread: Thread,
    resolvedName: string,
    scriptName: string | undefined,
    scripts: RunScript[],
    runKey: string,
  ): Promise<{ port: number; scriptName: string; ports: number[] }> {
    const siblings = threadsSharingWorktree(thread.worktreePath);
    const shared = mergeWorktreeActiveRuns(siblings);
    const existing =
      this.processes.get(runKey) ??
      siblings
        .map((t) => this.processes.get(`${t.id}:run:${resolvedName}`))
        .find(Boolean);
    const active = shared.activeRuns.find((r) => r.scriptName === resolvedName);
    if (existing && active) {
      return { port: active.port, scriptName: resolvedName, ports: active.ports };
    }
    // Legacy key
    if (!scriptName) {
      const legacy =
        this.processes.get(worktreeDevProcessKey(thread.worktreePath)) ??
        siblings.map((t) => this.processes.get(`${t.id}:dev`)).find(Boolean);
      if (legacy && shared.devPort) {
        return { port: shared.devPort, scriptName: resolvedName, ports: [shared.devPort] };
      }
    }

    // Persisted activeRuns without a live handle (crash / race) — free those
    // ports before allocating again so Start does not EADDRINUSE against ghosts.
    if (active && !existing) {
      killListenersOnPorts(collectActiveRunPorts([active]));
      this.syncWorktreeRuns(
        thread.worktreePath,
        shared.activeRuns.filter((r) => r.scriptName !== resolvedName),
        shared.devPort === active.port ? null : shared.devPort,
      );
    }

    const mode = getRunMode(thread.worktreePath, thread.repoPath);
    if (mode === 'nonconcurrent') {
      const here = normalizeWorktreePath(thread.worktreePath);
      for (const t of listThreads()) {
        if (normalizeWorktreePath(t.worktreePath) === here) continue;
        const runs = t.activeRuns ?? [];
        if (runs.length > 0 || t.devPort) {
          throw new Error(
            `run_mode is nonconcurrent — stop running scripts on thread ${t.id.slice(0, 8)} first`,
          );
        }
      }
    }

    // Same batching as setup output — dev servers log per-request lines.
    const runOutput = createLineCoalescer((chunk) => {
      this.emit({
        type: 'run_output',
        threadId: thread.id,
        scriptName: resolvedName,
        line: chunk,
      });
    });
    const handle = await startDevServer(
      thread.repoPath,
      thread.worktreePath,
      runOutput.push,
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
      this.processes.set(worktreeDevProcessKey(thread.worktreePath), {
        kind: 'dev',
        pid: handle.pid,
        startedAt,
        scriptName: resolvedName,
        kill: handle.kill,
      });
    }

    const latestShared = mergeWorktreeActiveRuns(threadsSharingWorktree(thread.worktreePath));
    const run: ActiveRun = {
      scriptName: resolvedName,
      port: handle.port,
      ports: handle.ports,
      startedAt,
    };
    const nextRuns = [
      ...latestShared.activeRuns.filter((r) => r.scriptName !== resolvedName),
      run,
    ];
    this.syncWorktreeRuns(
      thread.worktreePath,
      nextRuns,
      isDefault ? handle.port : latestShared.devPort,
    );
    this.emit({
      type: 'dev_server_started',
      threadId: thread.id,
      port: handle.port,
      scriptName: resolvedName,
    });
    void handle.done.then(() => {
      runOutput.flush();
      this.processes.delete(runKey);
      if (isDefault) this.processes.delete(worktreeDevProcessKey(thread.worktreePath));
      const latest = mergeWorktreeActiveRuns(threadsSharingWorktree(thread.worktreePath));
      const remaining = latest.activeRuns.filter((r) => r.scriptName !== resolvedName);
      this.syncWorktreeRuns(
        thread.worktreePath,
        remaining,
        isDefault ? null : latest.devPort,
      );
      this.emit({
        type: 'dev_server_stopped',
        threadId: thread.id,
        scriptName: resolvedName,
      });
    });
    return { port: handle.port, scriptName: resolvedName, ports: handle.ports };
  }

  /**
   * Persist a run-script intent for the desktop host (MCP/CLI while the board
   * is alive). Polls until Electron main adopts and fulfills it.
   */
  private async requestDesktopRunScript(
    thread: Thread,
    op: 'start' | 'stop',
    scriptName?: string,
  ): Promise<{ port: number; scriptName: string; ports: number[] } | null> {
    const latest = readThread(thread.id) ?? thread;
    const pending = latest.runScriptRequest;
    const claimedAt = pending?.claimedAt;
    const staleClaim =
      typeof claimedAt === 'string' &&
      Date.now() - Date.parse(claimedAt) > this.runScriptAdoptTimeoutMs;
    const sameIntent =
      pending &&
      pending.op === op &&
      (pending.scriptName ?? null) === (scriptName ?? null) &&
      !pending.error &&
      !pending.fulfilledAt &&
      !staleClaim;
    const request: RunScriptRequest = sameIntent
      ? pending!
      : {
          op,
          scriptName: scriptName ?? null,
          requestId: randomUUID(),
          requestedAt: new Date().toISOString(),
        };
    if (!sameIntent) {
      updateThread(thread.id, { runScriptRequest: request });
    }
    return this.waitForDesktopRunScript(thread.id, request, op, scriptName);
  }

  private async waitForDesktopRunScript(
    threadId: string,
    request: RunScriptRequest,
    op: 'start' | 'stop',
    scriptName?: string,
  ): Promise<{ port: number; scriptName: string; ports: number[] } | null> {
    const deadline = Date.now() + this.runScriptAdoptTimeoutMs;
    while (Date.now() < deadline) {
      const latest = readThread(threadId);
      if (!latest) {
        throw new Error('Thread disappeared while waiting for the desktop run script.');
      }
      const req = latest.runScriptRequest;
      if (req?.requestId === request.requestId && req.error) {
        throw new Error(req.error);
      }
      const shared = mergeWorktreeActiveRuns(threadsSharingWorktree(latest.worktreePath));
      const run = scriptName
        ? shared.activeRuns.find((r) => r.scriptName === scriptName)
        : shared.activeRuns[0];
      const fulfilled = req?.requestId === request.requestId && Boolean(req.fulfilledAt);
      const requestGone = !req || req.requestId !== request.requestId;
      if (op === 'start') {
        if (run && (fulfilled || requestGone || run.startedAt >= request.requestedAt)) {
          return { port: run.port, scriptName: run.scriptName, ports: run.ports };
        }
        if (fulfilled && !run) {
          throw new Error('Desktop reported the run script started, but it is not active.');
        }
      } else if (fulfilled) {
        // Do not treat missing activeRuns as success — a start may still be in
        // flight and would keep running after MCP already reported stopped.
        return null;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(
      op === 'start'
        ? 'Desktop did not start the run script in time. Is Sideboard.app running this worktree?'
        : 'Desktop did not stop the run script in time.',
    );
  }

  private async awaitStartingDev(worktreePath: string, scriptName?: string): Promise<void> {
    const keys = scriptName
      ? [worktreeRunProcessKey(worktreePath, scriptName)]
      : [...this.startingDev.keys()].filter((k) => isWorktreeRunProcessKey(k, worktreePath));
    await Promise.all(
      keys.map(async (key) => {
        const pending = this.startingDev.get(key);
        if (!pending) return;
        try {
          await pending;
        } catch {
          // start failed; Stop can still reap leftovers
        }
      }),
    );
  }

  async stopDev(threadRef: string, scriptName?: string): Promise<void> {
    const thread = this.requireThread(threadRef);
    if (!this.shouldOwnRunScripts()) {
      await this.requestDesktopRunScript(thread, 'stop', scriptName);
      return;
    }
    await this.awaitStartingDev(thread.worktreePath, scriptName);
    const siblings = threadsSharingWorktree(thread.worktreePath);
    const shared = mergeWorktreeActiveRuns(siblings);
    if (scriptName) {
      const keys = [
        worktreeRunProcessKey(thread.worktreePath, scriptName),
        ...siblings.map((t) => `${t.id}:run:${scriptName}`),
      ];
      let hadHandle = false;
      for (const key of keys) {
        const proc = this.processes.get(key);
        if (proc) {
          proc.kill();
          hadHandle = true;
        }
        this.processes.delete(key);
      }
      // Drop the legacy :dev alias when it points at this script.
      const legacyKey = worktreeDevProcessKey(thread.worktreePath);
      const legacy = this.processes.get(legacyKey);
      if (legacy?.scriptName === scriptName || (!legacy?.scriptName && scriptName === 'dev')) {
        if (legacy && !hadHandle) {
          legacy.kill();
          hadHandle = true;
        }
        this.processes.delete(legacyKey);
      }
      const run = shared.activeRuns.find((r) => r.scriptName === scriptName);
      // After app restart, handles are gone — free ports from persisted metadata.
      if (!hadHandle && run) {
        killListenersOnPorts(collectActiveRunPorts([run]));
      }
      const remaining = shared.activeRuns.filter((r) => r.scriptName !== scriptName);
      const isPrimary =
        shared.devPort != null &&
        run?.port === shared.devPort;
      this.syncWorktreeRuns(
        thread.worktreePath,
        remaining,
        isPrimary ? null : shared.devPort,
      );
      this.emit({ type: 'dev_server_stopped', threadId: thread.id, scriptName });
      return;
    }
    let hadHandle = false;
    for (const [key, proc] of [...this.processes.entries()]) {
      if (
        isWorktreeRunProcessKey(key, thread.worktreePath) ||
        siblings.some((t) => key.startsWith(`${t.id}:run:`) || key === `${t.id}:dev`)
      ) {
        proc.kill();
        hadHandle = true;
        this.processes.delete(key);
      }
    }
    if (!hadHandle && shared.activeRuns.length > 0) {
      killListenersOnPorts(collectActiveRunPorts(shared.activeRuns));
    }
    this.syncWorktreeRuns(thread.worktreePath, [], null);
    this.emit({ type: 'dev_server_stopped', threadId: thread.id });
  }

  /**
   * App quit: tear down every registered run/setup child and free persisted
   * ports so the next launch is not blocked by orphans.
   */
  stopAllRunScripts(): void {
    for (const [key, proc] of [...this.processes.entries()]) {
      if (proc.kind !== 'dev' && proc.kind !== 'setup') continue;
      try {
        proc.kill();
      } catch {
        // best-effort on quit
      }
      this.processes.delete(key);
    }
    this.reapOrphanedRunScripts({ force: true });
  }

  /**
   * After restart (or force quit), in-memory handles are gone but `activeRuns`
   * and OS listeners may remain. Kill by port and clear disk metadata.
   * Skips worktrees that still have a live handle unless `force` (quit path).
   */
  reapOrphanedRunScripts(opts?: { force?: boolean }): void {
    const force = opts?.force === true;
    const seen = new Set<string>();
    for (const thread of listThreads({ includeArchived: true })) {
      if (thread.status === 'archived') continue;
      if (isGlobalThread(thread)) continue;
      const wt = normalizeWorktreePath(thread.worktreePath);
      if (seen.has(wt)) continue;
      seen.add(wt);

      const siblings = threadsSharingWorktree(thread.worktreePath);
      const shared = mergeWorktreeActiveRuns(siblings);
      if (shared.activeRuns.length === 0 && shared.devPort == null) continue;

      const hasLiveHandle = [...this.processes.keys()].some(
        (k) =>
          isWorktreeRunProcessKey(k, thread.worktreePath) ||
          siblings.some((t) => k.startsWith(`${t.id}:run:`) || k === `${t.id}:dev`),
      );
      if (!force && hasLiveHandle) continue;

      killListenersOnPorts(collectActiveRunPorts(shared.activeRuns));
      if (shared.devPort != null) {
        killListenersOnPorts([shared.devPort]);
      }
      this.syncWorktreeRuns(thread.worktreePath, [], null);
      for (const sibling of siblings) {
        this.emit({ type: 'dev_server_stopped', threadId: sibling.id });
      }
    }
  }

  private syncWorktreeRuns(
    worktreePath: string,
    activeRuns: ActiveRun[],
    devPort: number | null,
  ): void {
    for (const sibling of threadsSharingWorktree(worktreePath)) {
      updateThread(sibling.id, { activeRuns, devPort });
    }
  }

  listThreadRunScripts(threadRef: string): RunScript[] {
    const thread = this.requireThread(threadRef);
    return listRunScripts(thread.worktreePath, thread.repoPath);
  }

  getActiveRuns(threadRef: string): ActiveRun[] {
    const thread = this.requireThread(threadRef);
    return mergeWorktreeActiveRuns(threadsSharingWorktree(thread.worktreePath)).activeRuns;
  }

  getSetupLog(threadRef: string): SetupLogSnapshot {
    const thread = this.getThread(threadRef);
    if (!thread) return readSetupLog(threadRef);
    const siblingIds = [
      thread.id,
      ...threadsSharingWorktree(thread.worktreePath).map((t) => t.id),
    ];
    const snap =
      resolveWorktreeSetupLog(
        readSetupLog(setupLogKeyForWorktree(thread.worktreePath)),
        [...new Set(siblingIds)].map((id) => readSetupLog(id)),
      ) ?? readSetupLog(thread.id);
    if (snap.running && !this.hasWorktreeSetupProcess(thread.worktreePath)) {
      return { ...snap, running: false };
    }
    return snap;
  }

  private hasWorktreeSetupProcess(worktreePath: string): boolean {
    if (this.processes.has(worktreeSetupProcessKey(worktreePath))) return true;
    return threadsSharingWorktree(worktreePath).some((t) =>
      this.processes.has(`${t.id}:setup`),
    );
  }

  /**
   * The worktree-keyed log is canonical (`resolveWorktreeSetupLog` prefers it
   * whenever it has output/running/exitCode); per-chat keys only exist for
   * records that predate it. Writing one key halves the sync persists during
   * `pnpm install`.
   */
  private writeSetupLog(worktreePath: string, fn: (key: string) => void): void {
    fn(setupLogKeyForWorktree(worktreePath));
  }

  async runSetup(
    threadRef: string,
    opts?: { stampLastError?: boolean },
  ): Promise<{ exitCode: number | null; source?: string | null }> {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Setup');
    const key = worktreeSetupProcessKey(thread.worktreePath);
    if (this.hasWorktreeSetupProcess(thread.worktreePath)) {
      throw new Error('Setup already running for this worktree');
    }

    const abort = new AbortController();
    this.processes.set(key, {
      kind: 'setup',
      startedAt: new Date().toISOString(),
      kill: () => abort.abort(),
    });
    this.writeSetupLog(thread.worktreePath, beginSetupLog);
    this.emit({ type: 'setup_started', threadId: thread.id });

    // `pnpm install` streams thousands of lines; one log append + one IPC
    // frame per tick instead of per line keeps the main thread responsive
    // while several worktrees are set up at once. `line` in the event is a
    // `\n`-joined chunk — every consumer already joins on `\n`.
    const output = createLineCoalescer((chunk) => {
      this.writeSetupLog(thread.worktreePath, (logKey) => appendSetupLog(logKey, chunk));
      this.emit({ type: 'setup_output', threadId: thread.id, line: chunk });
    });

    let finished = false;
    const finish = (exitCode: number | null, source?: string | null) => {
      if (finished) return;
      finished = true;
      output.flush();
      this.writeSetupLog(thread.worktreePath, (logKey) =>
        finishSetupLog(logKey, exitCode, source),
      );
      this.emit({ type: 'setup_finished', threadId: thread.id, exitCode });
    };

    try {
      const setup = await runWorkspaceSetup(
        thread.repoPath,
        thread.worktreePath,
        output.push,
        { signal: abort.signal },
      );

      if (!setup.ran) {
        const line =
          'No setup script in .sideboard/settings.toml, .conductor/settings.toml, .cursor/worktrees.json, or script/setup (bin/setup, scripts/setup)';
        output.push(line);
        finish(null, null);
        throw new Error(line);
      }
      if (setup.exitCode !== 0 && setup.exitCode !== null) {
        const live = readThread(thread.id);
        if (
          (opts?.stampLastError ?? true) &&
          shouldStampSetupLastError({
            turnInFlight:
              this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id),
            status: live?.status,
            hasQueuedPrompt: Boolean(live?.queue?.length),
          })
        ) {
          updateThread(thread.id, {
            lastError: `Setup exited ${setup.exitCode}`,
          });
        }
      }
      finish(setup.exitCode, setup.source);
      return { exitCode: setup.exitCode, source: setup.source };
    } catch (err) {
      finish(null, null);
      throw err;
    } finally {
      this.processes.delete(key);
    }
  }

  cancelSetup(threadRef: string): void {
    const thread = this.requireThread(threadRef);
    const keys = [
      worktreeSetupProcessKey(thread.worktreePath),
      ...threadsSharingWorktree(thread.worktreePath).map((t) => `${t.id}:setup`),
    ];
    for (const key of [...new Set(keys)]) {
      const proc = this.processes.get(key);
      if (proc) proc.kill();
    }
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

  /** Bound Settings → History. After archive always; reconcile is interval-gated. */
  private enforceHistoryRetention(): void {
    try {
      cleanupArchivedHistory();
    } catch {
      // Best-effort — next archive or reconcile retries.
    }
  }

  cleanupHistory(opts?: { dryRun?: boolean; purgeOlderThanDays?: number; force?: boolean }) {
    return cleanupArchivedHistory({
      dryRun: opts?.dryRun,
      purgeOlderThanDays: opts?.purgeOlderThanDays,
      force: opts?.force,
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
        reuseExisting: false,
      });
      created.push(thread);
    }
    return created;
  }

  async waitForTurn(
    threadRef: string,
    timeoutMs = 600_000,
    opts?: { resolveIfStillRunning?: boolean },
  ): Promise<Thread> {
    const thread = this.healStaleReportedActivity(this.requireThread(threadRef));
    if (!this.threadLooksLive(thread)) {
      return thread;
    }
    const start = Date.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        off();
        fn();
      };
      const off = this.on((event) => {
        if (!('threadId' in event) || event.threadId !== thread.id) return;
        if (event.type === 'turn_finished' || event.type === 'error') {
          const latest = readThread(thread.id);
          if (!latest) {
            finish(() => reject(new Error(`Thread not found: ${thread.id}`)));
            return;
          }
          finish(() => resolve(latest));
          return;
        }
        if (event.type === 'status_changed') {
          const latest = readThread(thread.id);
          if (!latest) {
            finish(() => reject(new Error(`Thread not found: ${thread.id}`)));
            return;
          }
          if (!['running', 'queued'].includes(latest.status)) {
            finish(() => resolve(latest));
          }
        }
      });
      timer = setInterval(() => {
        const raw = readThread(thread.id);
        if (!raw) {
          finish(() => reject(new Error(`Thread not found: ${thread.id}`)));
          return;
        }
        const current = this.healStaleReportedActivity(raw);
        if (!this.threadLooksLive(current)) {
          finish(() => resolve(current));
          return;
        }
        if (Date.now() - start > timeoutMs) {
          if (opts?.resolveIfStillRunning) {
            finish(() => resolve(current));
          } else {
            finish(() => reject(new Error('wait_for_turn timed out')));
          }
        }
      }, 200);
    });
  }

  getThreadUsage(threadRef: string): {
    /** Billed totals across all agent turns (includes costUsd when providers reported it). */
    usage: TokenUsage | null;
    /** Usage for the most recent agent turn only. */
    lastTurnUsage: TokenUsage | null;
  } {
    const thread = this.requireThread(threadRef);
    const lastAgent = [...thread.messages].reverse().find((m) => m.role === 'agent');
    return {
      usage: sumUsageList(thread.messages.map((m) => m.usage)),
      lastTurnUsage: lastAgent?.usage ?? null,
    };
  }

  getTurnResult(threadRef: string): {
    text: string;
    status: string;
    sessionId: string | null;
    lastError: string | null;
    stillRunning: boolean;
    progress: string | null;
    lastActivityAt: string | null;
    /** Token + cost for the last finished agent turn, when reported. */
    usage: TokenUsage | null;
  } {
    const thread = this.healStaleReportedActivity(this.requireThread(threadRef));
    const lastAgent = [...thread.messages].reverse().find((m) => m.role === 'agent');
    const lastError = thread.lastError ?? null;
    const rawText = (lastAgent?.text ?? '').trim();
    const text =
      (rawText && !isInternalAgentStatusText(rawText) ? rawText : '') ||
      (thread.status === 'error' || thread.status === 'stopped' || thread.status === 'broken'
        ? lastError ?? ''
        : '');
    const stillRunning = this.threadLooksLive(thread);
    const live = stillRunning ? readTurnLive(thread.id) : null;
    const liveSummary =
      live?.summary && !isInternalAgentStatusText(live.summary) ? live.summary : null;
    const queuedHint =
      stillRunning && thread.status === 'queued' && !liveSummary
        ? 'Queued — waiting for a concurrency slot'
        : null;
    return {
      text,
      status: thread.status,
      sessionId: thread.sessionId,
      lastError,
      stillRunning,
      progress: liveSummary ?? queuedHint,
      lastActivityAt: live?.updatedAt ?? null,
      usage: lastAgent?.usage ?? null,
    };
  }

  private assertNotGlobal(thread: Thread, action: string): void {
    if (isGlobalThread(thread)) {
      throw new Error(`${action} is not available on the global coordinator`);
    }
  }

  /** MCP set_caffeinate is a detached hold — closing the chat must not leave the Mac awake. */
  private releaseOrchestratorCaffeinate(thread: Thread): void {
    if (!isOrchestratorThread(thread)) return;
    try {
      releaseCaffeinateHoldForThread(thread.id);
    } catch {
      // Best-effort — a dead pid is already treated as released.
    }
  }

  async diff(
    threadRef: string,
    opts?: {
      scope?: DiffScope;
      commitSha?: string | null;
      base?: string;
      includePatches?: boolean;
      includeMeta?: boolean;
      includeUntracked?: boolean;
      path?: string;
    },
  ) {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Diff');
    return getDiff(thread.worktreePath, thread.repoPath, {
      scope: opts?.scope,
      commitSha: opts?.commitSha,
      base: opts?.base,
      includePatches: opts?.includePatches,
      includeMeta: opts?.includeMeta,
      includeUntracked: opts?.includeUntracked,
      path: opts?.path,
      lastTurnBase: this.turnBaselines.get(thread.id) ?? null,
    });
  }

  async worktreeDirtyStat(threadRef: string): Promise<WorktreeDirtyStat> {
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'Diff');
    return getWorktreeDirtyStat(thread.worktreePath);
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

  async statPath(
    threadRef: string,
    relativePath: string,
  ): Promise<'file' | 'dir' | 'missing'> {
    const thread = this.requireThread(threadRef);
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      return 'missing';
    }
    if (!relativePath || relativePath === '.') return 'dir';
    try {
      return statWorktreePath(thread.worktreePath, relativePath);
    } catch {
      return 'missing';
    }
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
      if (shouldStopRunOnPrRetarget(thread.prUrl, result.prUrl)) {
        this.stopDev(thread.id);
      }
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

  async markPrReady(
    threadRef: string,
  ): Promise<{ url: string; state: string; isDraft: boolean }> {
    const { thread, selectors, cwd } = await this.withPrSelector(threadRef);
    this.assertNotGlobal(thread, 'Ready for review');
    const selector = selectors[0];
    if (!selector) throw new Error('No pull request linked to this thread');
    const result = await markGithubPrReady(cwd, selector);
    const meta = await fetchPrMeta(cwd, selector);
    if (meta) {
      await this.persistPrMetaAndMaybeArchive(thread, { ...meta, isDraft: false });
      return { url: meta.url || result.url, state: meta.state || result.state, isDraft: false };
    }
    await this.persistPrMetaAndMaybeArchive(thread, {
      number: 0,
      title: thread.prTitle ?? thread.title,
      url: result.url || thread.prUrl || '',
      state: result.state || 'OPEN',
      isDraft: false,
      reviewDecision: null,
      baseRefName: '',
      headRefName: '',
      isInMergeQueue: false,
      mergeable: null,
      mergeStateStatus: null,
    });
    return { ...result, isDraft: false };
  }

  async mergePr(threadRef: string): Promise<{ url: string; state: string }> {
    const { thread, selectors, cwd } = await this.withPrSelector(threadRef);
    this.assertNotGlobal(thread, 'Merge PR');
    const selector = selectors[0];
    if (!selector) throw new Error('No pull request linked to this thread');
    const result = await mergeGithubPr(cwd, selector);
    const state = normalizePrState(result.state) || 'MERGED';
    const metaLike: PrMeta = {
      number: 0,
      title: thread.prTitle ?? thread.title,
      url: result.url || thread.prUrl || '',
      state,
      isDraft: false,
      reviewDecision: null,
      baseRefName: '',
      headRefName: '',
      isInMergeQueue: false,
      mergeable: null,
      mergeStateStatus: null,
    };
    await this.persistPrMetaAndMaybeArchive(thread, metaLike);
    return { url: metaLike.url, state };
  }

  /** Resolve PR selectors and optionally persist `prUrl` when found. */
  private async withPrSelector(threadRef: string): Promise<{
    thread: Thread;
    selectors: string[];
    cwd: string;
    headUrl: string | null;
  }> {
    const thread = this.requireThread(threadRef);
    const cwd = thread.worktreePath;
    if (!cwd?.trim()) {
      throw new Error(`Thread ${threadRef} has no worktreePath`);
    }
    let headUrl: string | null = null;
    try {
      const head = await getPrForHeadBranch(cwd, thread.branchName);
      headUrl = head?.url?.trim() || null;
    } catch {
      headUrl = null;
    }
    return { thread, selectors: connectedPrSelectors(thread, headUrl), cwd, headUrl };
  }

  async getPrChecks(threadRef: string): Promise<PrCheckRun[] | null> {
    const { selectors, cwd } = await this.withPrSelector(threadRef);
    for (const selector of selectors) {
      const checks = await getPrChecks(cwd, selector);
      if (checks) return checks;
    }
    return null;
  }

  async getPrMeta(threadRef: string): Promise<PrMeta | null> {
    const { thread, selectors, cwd, headUrl } = await this.withPrSelector(threadRef);
    for (const selector of selectors) {
      const meta = await fetchPrMeta(cwd, selector);
      if (!meta) continue;
      const live = this.requireThread(thread.id);
      if (
        !shouldPersistFetchedPrMeta({
          metaUrl: meta.url,
          livePrUrl: live.prUrl,
          headPrUrl: headUrl,
        })
      ) {
        continue;
      }
      await this.persistPrMetaAndMaybeArchive(live, meta);
      return meta;
    }
    return null;
  }

  /**
   * Persist PR URL/title/state and Conductor-style auto-archive when the PR
   * first becomes MERGED.
   */
  private async persistPrMetaAndMaybeArchive(
    thread: Thread,
    meta: PrMeta,
  ): Promise<void> {
    const prevState = normalizePrState(thread.prState);
    const nextState = normalizePrState(meta.state);
    // Same worktree, new PR (merge → continue → create): drop the old Run so
    // it is not left serving a checkout that no longer matches the connected PR.
    if (shouldStopRunOnPrRetarget(thread.prUrl, meta.url)) {
      this.stopDev(thread.id);
    }
    // PR identity/lifecycle is worktree-scoped — every live chat tab follows.
    const siblings = threadsSharingWorktree(thread.worktreePath);
    const targets = siblings.length > 0 ? siblings : [thread];
    for (const t of targets) {
      const patch = threadPrMetaPatch(t, meta);
      if (Object.keys(patch).length === 0) continue;
      updateThread(t.id, patch);
    }
    const titled = this.requireThread(thread.id);
    if (!titled.userSetTitle && meta.title && titled.title !== meta.title) {
      updateThread(thread.id, { title: meta.title });
    }

    const { autoArchiveOnMergeEnabled } = await import('../store/app-settings.js');
    const latest = this.requireThread(thread.id);
    if (
      !shouldAutoArchiveOnPrMerge({
        previousPrState: prevState || null,
        nextPrState: nextState,
        threadStatus: latest.status,
        skipAutoArchiveOnMerge: latest.skipAutoArchiveOnMerge,
        autoArchiveEnabled: autoArchiveOnMergeEnabled(),
        isGlobal: isGlobalThread(latest),
      })
    ) {
      return;
    }

    for (const t of threadsSharingWorktree(latest.worktreePath)) {
      if (this.requireThread(t.id).status === 'archived') continue;
      await this.archive(t.id);
    }
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
    if (current?.prUrl && shouldStopRunOnPrRetarget(thread.prUrl, current.prUrl)) {
      this.stopDev(thread.id);
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
      void this.runSetupAfterCreate(id);
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
      void this.runSetupAfterCreate(result.thread.id);
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
      void this.runSetupAfterCreate(id);
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
      void this.runSetupAfterCreate(id);
    }
    return { stack: result.stack, threads: result.threads };
  }

  async getPrDetails(threadRef: string): Promise<PrDetails | null> {
    const { thread, selectors, cwd } = await this.withPrSelector(threadRef);
    let details: PrDetails | null = null;
    for (const selector of selectors) {
      details = await getPrDetails(cwd, selector);
      if (details) break;
    }
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

  /**
   * Desktop git buttons + MCP `ask_git`. Always queues the worktree agent
   * with the action prompt (same path as Resolve). Repository `[prompts]`
   * overrides apply when set.
   */
  async askGit(threadRef: string, action: AgentGitAction): Promise<Thread> {
    if (!AGENT_GIT_ACTIONS.includes(action)) {
      throw new Error(`Unknown git action: ${action}`);
    }
    const thread = this.requireThread(threadRef);
    this.assertNotGlobal(thread, 'ask_git');
    if (isOrchestratorThread(thread)) {
      throw new Error(
        'ask_git targets a worktree agent thread (not the orchestrator). Pass a child/worktree thread ref.',
      );
    }
    if ((action === 'merge' || action === 'ready-for-review') && !thread.prUrl) {
      throw new Error(
        'No pull request linked. Ask the worktree agent to open a draft PR first (ask_git create-draft).',
      );
    }
    let prBase: string | undefined;
    if (action === 'resolve-conflicts') {
      try {
        const details = await this.getPrDetails(threadRef);
        prBase = details?.baseRefName?.trim() || undefined;
      } catch {
        // Fall back to the generic merge-remote-branch phrase.
      }
    }
    const settings = loadWorkspaceSettings(thread.worktreePath, thread.repoPath);
    return this.send(
      threadRef,
      resolveSidebarGitPrompt(action, {
        prBase,
        createPr: settings?.prompts?.createPr,
        resolveMergeConflicts: settings?.prompts?.resolveMergeConflicts,
      }),
      {
        followUp: resolveOrchChildFollowUp(),
      },
    );
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
    void this.runSetupAfterCreate(thread.id);
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

  /**
   * Last-tab teardown must see siblings already archived. Serialize per
   * worktree so parallel archive/purge of sibling tabs still removes once.
   */
  private enqueueWorktreeTeardown<T>(
    thread: Thread,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = isGlobalThread(thread)
      ? `archive:global:${thread.id}`
      : `archive:wt:${normalizeWorktreePath(thread.worktreePath)}`;
    return enqueueByKey(key, fn);
  }

  async archive(threadRef: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    return this.enqueueWorktreeTeardown(thread, () => this.archiveUnlocked(threadRef));
  }

  private async archiveUnlocked(threadRef: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id, { notifyParent: false });
    this.releaseOrchestratorCaffeinate(thread);
    if (isGlobalThread(thread)) {
      const archived = setStatus(thread.id, 'archived');
      this.emit({ type: 'status_changed', threadId: archived.id, status: 'archived' });
      this.enforceHistoryRetention();
      return archived;
    }
    const siblings = threadsSharingWorktree(thread.worktreePath).filter((t) => t.id !== thread.id);
    // Only tear down the worktree when this is the last active chat tab.
    if (siblings.length === 0) {
      this.stopDev(thread.id);
      if (shouldRemoveWorktreeOnTeardown(thread)) {
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
    }
    const archived = setStatus(thread.id, 'archived');
    this.emit({ type: 'status_changed', threadId: archived.id, status: 'archived' });
    this.enforceHistoryRetention();
    // Archiving the last worktree must not unregister the project — keep it in
    // the sidebar so the user can create a new thread without re-adding it.
    if (thread.repoPath && !isGlobalRepoPath(thread.repoPath)) {
      try {
        const { ensureWorkspace } = await import('../store/workspaces.js');
        await ensureWorkspace(thread.repoPath);
      } catch {
        // Best-effort — repo may have been deleted on disk.
      }
    }
    return archived;
  }

  async purge(threadRef: string, opts?: { deleteBranch?: boolean }): Promise<void> {
    const thread = this.requireThread(threadRef);
    await this.enqueueWorktreeTeardown(thread, () => this.purgeUnlocked(threadRef, opts));
  }

  private async purgeUnlocked(
    threadRef: string,
    opts?: { deleteBranch?: boolean },
  ): Promise<void> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id, { notifyParent: false });
    this.releaseOrchestratorCaffeinate(thread);
    if (isGlobalThread(thread)) {
      deleteThreadRecord(thread.id);
      return;
    }
    const siblings = threadsSharingWorktree(thread.worktreePath).filter((t) => t.id !== thread.id);
    if (siblings.length === 0) {
      this.stopDev(thread.id);
      if (shouldRemoveWorktreeOnTeardown(thread)) {
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
      const restored = setStatus(thread.id, 'idle');
      this.emit({ type: 'status_changed', threadId: restored.id, status: restored.status });
      return restored;
    }
    if (!existsSync(thread.worktreePath)) {
      if (isCowboyThread(thread) || isPrimaryCheckoutThread(thread)) {
        throw new Error(
          `Cowboy checkout missing: ${thread.worktreePath}. Re-add the project folder, then restore.`,
        );
      }
      const { createThreadWorktree } = await import('../git/worktree.js');
      // Recreate worktree from existing branch
      const slug = thread.worktreePath.split('/').pop()!;
      const dest = thread.worktreePath;
      await withRepoGitLock(thread.repoPath, async () => {
        await git(['worktree', 'add', dest, thread.branchName], thread.repoPath);
      });
      const { ensureWorktreeSideboardIgnored } = await import('../git/worktree-exclude.js');
      await ensureWorktreeSideboardIgnored(dest);
      void createThreadWorktree;
      void slug;
    }

    // Conductor guard: unarchiving a merged-PR workspace must not immediately
    // re-archive. Persist live MERGED state (when known) and set the skip flag.
    const restorePatch: Partial<Thread> = {};
    let alreadyMerged = normalizePrState(thread.prState) === 'MERGED';
    if (!alreadyMerged && thread.prUrl?.trim() && thread.worktreePath?.trim()) {
      try {
        const selector = resolvePrSelector(thread);
        if (selector) {
          const meta = await fetchPrMeta(thread.worktreePath, selector);
          if (meta) {
            const state = normalizePrState(meta.state);
            if (meta.url && meta.url !== thread.prUrl) restorePatch.prUrl = meta.url;
            if (meta.title && meta.title !== thread.prTitle) restorePatch.prTitle = meta.title;
            if (state) restorePatch.prState = state;
            if (state === 'MERGED') alreadyMerged = true;
          }
        }
      } catch {
        // Offline / gh unavailable — fall through with cached state.
      }
    }
    if (alreadyMerged) restorePatch.skipAutoArchiveOnMerge = true;
    if (Object.keys(restorePatch).length > 0) {
      updateThread(thread.id, restorePatch);
    }

    const restored = setStatus(thread.id, 'idle');
    this.emit({ type: 'status_changed', threadId: restored.id, status: restored.status });
    return restored;
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
  const thread = await orch.createThread({
    sourceType: 'branch',
    sourceRef: 'default',
    ...createOpts,
  }).catch(async () => {
    const { resolveDefaultBranch, resolveRepoRoot } = await import('../git/worktree.js');
    const repo = await resolveRepoRoot(repoPath);
    const def = await resolveDefaultBranch(repo);
    return orch.createThread({
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

