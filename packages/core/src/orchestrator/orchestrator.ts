import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { spawnAgentTurn, type SpawnTurnHandle } from '../agents/spawn.js';
import { getAdapter } from '../agents/index.js';
import {
  getPrChecks,
  getPrDetails,
  removeWorktree,
  resolvePrSelector,
} from '../git/worktree.js';
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
  Thread,
  ThreadOptionsPatch,
} from '../types/thread.js';
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
import {
  createChatTab as createChatTabImpl,
  forkChatTab as forkChatTabImpl,
  threadsSharingWorktree,
} from '../threads/chat-tabs.js';
import { forkThreadWorktree as forkThreadWorktreeImpl } from '../threads/fork-worktree.js';
import {
  adoptThread,
  importConductorWorkspaceAsync,
  listConductorWorkspaces,
} from '../threads/adopt.js';
import { confirmLand, previewLand } from '../land/land.js';
import {
  captureTurnBaseline,
  getDiff,
  getDiffSummary,
  initializeGitRepository,
  listWorktreeFiles,
  readWorktreeFile,
  writeWorktreeFile,
} from '../diff/diff.js';
import { discoverSkills, type SkillInfo } from '../skills/discover.js';
import { expandComposerPrompt } from '../composer/expand.js';
import {
  buildSessionSeed,
  maybeCompactContext,
} from '../composer/context-compact.js';
import {
  formatAgentInstructions,
  formatRenameBranchDirective,
  formatWorktreeDirective,
  loadAgentInstructions,
} from '../agents/instructions.js';
import { PLAN_MODE_INSTRUCTION } from '../agents/types.js';
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
  /** WIP snapshot SHA at the start of the latest agent turn (per thread). */
  private readonly turnBaselines = new Map<string, string>();
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

  async reconcile(
    repoPath?: string,
    opts?: {
      /**
       * When true (default), mark disk-status `running` threads with no in-process
       * turn as stopped. Must stay false in Sideboard MCP subprocesses — they do
       * not own agent turns, so every live parent turn looks "dead".
       */
      reclaimStaleTurns?: boolean;
    },
  ): Promise<void> {
    const reclaimStaleTurns = opts?.reclaimStaleTurns !== false;

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
        if (reclaimStaleTurns && this.isStaleRunningThread(thread.id, thread.status)) {
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
      if (reclaimStaleTurns && this.isStaleRunningThread(thread.id, thread.status)) {
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

    // Drain any persisted queues
    for (const thread of listThreads()) {
      if (thread.queue.length > 0) {
        void this.drainQueue(thread.id);
      }
    }
  }

  getThreads(includeArchived = false): Thread[] {
    return listThreads({ includeArchived });
  }

  getThread(idOrRef: string): Thread | null {
    return findThreadByRef(idOrRef) ?? readThread(idOrRef);
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    let thread = await createThread(input, (line) => {
      this.emit({
        type: 'turn_output',
        threadId: 'pending',
        event: { type: 'stdout', data: line },
      });
    });
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });

    const { autoRunAfterSetupEnabled } = await import('../store/app-settings.js');
    if (autoRunAfterSetupEnabled()) {
      try {
        await this.startDev(thread.id);
      } catch {
        // Best-effort — setup/run script may be missing.
      }
    }

    const prompt = input.prompt?.trim();
    if (prompt) {
      thread = await this.send(thread.id, prompt);
    }
    return thread;
  }

  listWorkspaces(): Workspace[] {
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

  async send(threadRef: string, prompt: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    return withThreadLock(thread.id, async () => {
      const current = this.requireThread(thread.id);
      const queue = [...current.queue, prompt];
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

  private async drainQueue(threadId: string): Promise<void> {
    if (this.draining.has(threadId)) return;
    this.draining.add(threadId);
    try {
      while (true) {
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
        if (this.activeTurns.has(threadId)) {
          await new Promise((r) => setTimeout(r, 100));
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

    appendMessage(threadId, {
      role: 'user',
      text: prompt,
      ts: new Date().toISOString(),
    });

    thread = this.requireThread(threadId);
    const { agentPrompt: expandedPrompt } = expandComposerPrompt(
      thread.worktreePath,
      prompt,
      {
        attachments: thread.attachments,
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
    const agentPrompt = [
      thread.planMode ? PLAN_MODE_INSTRUCTION : null,
      orchestrationReminder,
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
      isBrightsy || isOrchestration ? null : formatWorktreeDirective(fresh);
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
      renameBranchDirective,
      ...(fresh.agent === 'claude' && fresh.sessionId
        ? []
        : [instructions, seed]),
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    try {
      const handle = await spawnAgentTurn(
        fresh,
        { cachedPrefix, prompt: agentPrompt },
        (event) => {
          this.emit({ type: 'turn_output', threadId, event });
          if (event.type === 'session_id') {
            updateThread(threadId, { sessionId: event.data });
          }
        },
      );
      this.activeTurns.set(threadId, handle);
      this.startingTurns.delete(threadId);
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
      if (result.assistantText.trim() || result.parts.length > 0) {
        appendMessage(threadId, {
          role: 'agent',
          text: result.assistantText.trim(),
          parts: result.parts.length > 0 ? result.parts : undefined,
          durationMs: Math.max(0, Date.now() - turnStartedAt),
          usage: result.usage ?? undefined,
          ts: new Date().toISOString(),
        });
      }
      // Claude may call ExitPlanMode after drafting a plan. Sideboard plan mode
      // is sticky until the user turns it off — drop the session so the next
      // turn re-enters plan mode with --permission-mode plan instead of resuming
      // an exited-plan Claude session.
      const afterTurn = this.requireThread(threadId);
      if (
        afterTurn.planMode &&
        afterTurn.agent === 'claude' &&
        result.parts.some(
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
        this.emit({ type: 'turn_finished', threadId, exitCode: result.exitCode });
      } else {
        setStatus(threadId, result.exitCode === 0 ? 'idle' : 'error', result.exitCode === 0 ? null : `exit ${result.exitCode}`);
        this.emit({
          type: 'status_changed',
          threadId,
          status: result.exitCode === 0 ? 'idle' : 'error',
        });
        this.emit({ type: 'turn_finished', threadId, exitCode: result.exitCode });
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
      }
    } finally {
      this.startingTurns.delete(threadId);
      this.activeTurns.delete(threadId);
      this.processes.delete(`${threadId}:agent`);
      this.stoppedTurns.delete(threadId);
      this.runningCount = Math.max(0, this.runningCount - 1);
    }
  }

  /**
   * Stop an in-flight agent turn.
   * Default `clearQueue: true` (force-stop): kills the turn AND empties queued prompts
   * so drainQueue cannot continue / re-start work after an intentional stop. Desktop,
   * CLI, MCP, and cloud-connect all share this default.
   */
  stop(threadRef: string, opts?: { clearQueue?: boolean }): Thread {
    const clearQueue = opts?.clearQueue !== false;
    const thread = this.requireThread(threadRef);
    const inFlight =
      this.activeTurns.has(thread.id) || this.startingTurns.has(thread.id);
    // Only sticky-mark when a turn is in flight — otherwise a later send/runTurn
    // would inherit a stale stop and treat a normal finish as intentional stop.
    if (inFlight) {
      this.stoppedTurns.add(thread.id);
    }
    if (clearQueue && thread.queue.length > 0) {
      updateThread(thread.id, { queue: [] });
      this.emit({ type: 'queue_changed', threadId: thread.id, queue: [] });
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
  ): Promise<{ path: string; content: string; truncated: boolean; binary: boolean }> {
    const thread = this.requireThread(threadRef);
    // Prevent path escape
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      throw new Error('Invalid path');
    }
    return readWorktreeFile(thread.worktreePath, relativePath);
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
        const details = await getPrDetails(thread.worktreePath, result.prUrl);
        if (details?.title) patch.prTitle = details.title;
      } catch {
        // ignore — URL alone is enough
      }
      updateThread(thread.id, patch);
      await syncThreadBranchFromGit(thread.id);
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

  setThreadOptions(threadRef: string, patch: ThreadOptionsPatch): Thread {
    const thread = this.requireThread(threadRef);
    const next: Partial<Thread> = {};
    if (patch.autonomy !== undefined) next.autonomy = patch.autonomy;
    if (patch.fast !== undefined) next.fast = patch.fast;
    if (patch.planMode !== undefined) next.planMode = patch.planMode;
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.agent !== undefined) {
      next.agent = patch.agent;
      // Model aliases are agent-specific; clear when switching unless the patch
      // also sets a new model (Brightsy uses model for agent:/model: targets).
      if (patch.agent !== 'claude' && patch.model === undefined) next.model = null;
      // Session ids are agent-specific — never resume Claude/Codex under Brightsy.
      next.sessionId = null;
    }
    return updateThread(thread.id, next);
  }

  createChatTab(input: {
    fromThreadId: string;
    agent?: Thread['agent'];
    title?: string;
  }): Thread {
    return createChatTabImpl(input);
  }

  forkChatTab(input: {
    threadId: string;
    throughIndex?: number;
    agent?: Thread['agent'];
    title?: string;
  }): Thread {
    return forkChatTabImpl(input);
  }

  async forkThreadWorktree(input: {
    threadId: string;
    throughIndex?: number;
    agent?: Thread['agent'];
    title?: string;
  }): Promise<Thread> {
    const thread = await forkThreadWorktreeImpl(input, (line) => {
      this.emit({
        type: 'turn_output',
        threadId: 'pending',
        event: { type: 'stdout', data: line },
      });
    });
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });
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
  fast?: boolean;
  planMode?: boolean;
  attachments?: Thread['attachments'];
}): Promise<Thread> {
  const repoPath = opts.repoPath?.trim();

  // Default: Global workspace (no git home). Soccer-team nickname for the
  // sidebar title; goal stays on sourceRef.
  if (!repoPath || isGlobalRepoPath(repoPath)) {
    return createGlobalChat({
      sourceRef: opts.goal,
      agent: opts.agent,
      autonomy: opts.autonomy,
      model: opts.model,
      fast: opts.fast,
      planMode: opts.planMode,
      attachments: opts.attachments,
    });
  }

  // Legacy: pinned-repo orchestration (real worktree). Prefer Global for new work.
  const { titleFromPrompt } = await import('../threads/title.js');
  const title = titleFromPrompt(opts.goal) || 'Orchestration';
  const createOpts = {
    agent: opts.agent,
    repoPath,
    title,
    autonomy: opts.autonomy,
    model: opts.model,
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
  return upd(thread.id, {
    sourceType: 'orchestration',
    sourceRef: opts.goal,
  });
}

