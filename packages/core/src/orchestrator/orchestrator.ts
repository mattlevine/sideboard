import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { spawnAgentTurn, type SpawnTurnHandle } from '../agents/spawn.js';
import { getAdapter } from '../agents/index.js';
import {
  getPrChecks,
  getPrDetails,
  listWorktrees,
  removeWorktree,
  resolvePrSelector,
} from '../git/worktree.js';
import { runSetupScript, startDevServer } from '../hook/conductor.js';
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
import type {
  AgentKind,
  Autonomy,
  CreateThreadInput,
  DiffScope,
  OrchestratorEvent,
  OrchestratorRuntime,
  PrCheckRun,
  PrDetails,
  Thread,
  ThreadOptionsPatch,
} from '../types/thread.js';
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

interface RegisteredProcess {
  kind: 'agent' | 'dev';
  pid?: number;
  startedAt: string;
  kill: () => void;
}

export class Orchestrator {
  readonly events = new EventEmitter();
  private readonly processes = new Map<string, RegisteredProcess>();
  private readonly activeTurns = new Map<string, SpawnTurnHandle>();
  private readonly draining = new Set<string>();
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

  async reconcile(repoPath?: string): Promise<void> {
    for (const thread of listThreads({ includeArchived: true })) {
      if (thread.status === 'archived') continue;
      if (!existsSync(thread.worktreePath)) {
        setStatus(thread.id, 'broken', 'Worktree missing on disk');
        this.emit({ type: 'status_changed', threadId: thread.id, status: 'broken' });
        continue;
      }
      if (thread.status === 'running' && !this.activeTurns.has(thread.id)) {
        setStatus(thread.id, 'stopped', 'Process died (reconciled on startup)');
        this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
      }
    }

    if (repoPath && existsSync(repoPath)) {
      const wts = await listWorktrees(repoPath);
      const known = new Set(listThreads({ includeArchived: true }).map((t) => t.worktreePath));
      for (const wt of wts) {
        const isSideboardWt =
          wt.path.includes('/.sideboard/worktrees/') ||
          wt.path.includes('/sideboard/workspaces/');
        if (isSideboardWt && !known.has(wt.path)) {
          // orphaned — leave for manual cleanup; surface via events if needed
        }
      }
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
    this.runningCount += 1;
    const turnStartedAt = Date.now();
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
    const agentPrompt = thread.planMode
      ? `${PLAN_MODE_INSTRUCTION}\n\n${expandedPrompt}`
      : expandedPrompt;
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
    // Always remind agents of the worktree. Claude/Brightsy skip project AGENTS.md
    // injection, but they still need this isolation rule on every turn (incl. resume).
    const worktreeDirective = formatWorktreeDirective(fresh);
    const settings = loadWorkspaceSettings(fresh.worktreePath, fresh.repoPath);
    const { autoRenameBranchEnabled } = await import('../store/app-settings.js');
    const renameBranchDirective = autoRenameBranchEnabled()
      ? formatRenameBranchDirective(fresh, {
          customPrompt: settings?.prompts?.renameBranch,
        })
      : null;
    // Claude Code auto-loads CLAUDE.md / AGENTS.md for `-p` turns — duplicating
    // them in every user message wastes tokens and adds cache-breakpoint pressure.
    // Brightsy agents already carry their own server-side instructions; stuffing
    // local AGENTS.md into every turn has also triggered empty model responses.
    const instructions =
      fresh.agent === 'claude' || fresh.agent === 'brightsy'
        ? null
        : formatAgentInstructions(instructionFiles);
    // Fresh / compacted sessions have no CLI resume — seed from Sideboard history.
    let seed: string | null = null;
    if (!fresh.sessionId) {
      const prior = fresh.messages.slice(0, -1);
      // Brightsy has no session resume and rejects/empty-completes on oversized
      // tool-heavy seeds — keep a short text-only transcript.
      seed =
        fresh.agent === 'brightsy'
          ? buildSessionSeed(prior.slice(-8), { tools: 'none' })
          : buildSessionSeed(prior);
    }

    // Worktree directive is always included (even on Claude resume). Project
    // instructions + seed only on fresh sessions / non-Claude agents.
    // Rename-branch is Conductor-style: only while still on the placeholder branch.
    const cachedPrefix = [
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
      setStatus(threadId, result.exitCode === 0 ? 'idle' : 'error', result.exitCode === 0 ? null : `exit ${result.exitCode}`);
      this.emit({
        type: 'status_changed',
        threadId,
        status: result.exitCode === 0 ? 'idle' : 'error',
      });
      this.emit({ type: 'turn_finished', threadId, exitCode: result.exitCode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await syncThreadBranchFromGit(threadId).catch(() => undefined);
      setStatus(threadId, 'error', message);
      this.emit({ type: 'error', threadId, message });
      this.emit({ type: 'status_changed', threadId, status: 'error' });
      this.emit({ type: 'turn_finished', threadId, exitCode: 1 });    } finally {
      this.activeTurns.delete(threadId);
      this.processes.delete(`${threadId}:agent`);
      this.runningCount = Math.max(0, this.runningCount - 1);
    }
  }

  stop(threadRef: string): Thread {
    const thread = this.requireThread(threadRef);
    const handle = this.activeTurns.get(thread.id);
    if (handle) handle.kill();
    const proc = this.processes.get(`${thread.id}:agent`);
    if (proc) proc.kill();
    setStatus(thread.id, 'stopped');
    this.emit({ type: 'status_changed', threadId: thread.id, status: 'stopped' });
    return this.requireThread(thread.id);
  }

  async startDev(threadRef: string): Promise<{ port: number }> {
    const thread = this.requireThread(threadRef);
    const existing = this.processes.get(`${thread.id}:dev`);
    if (existing && thread.devPort) {
      return { port: thread.devPort };
    }
    const handle = await startDevServer(thread.repoPath, thread.worktreePath, (line) => {
      this.emit({
        type: 'turn_output',
        threadId: thread.id,
        event: { type: 'stdout', data: `[dev] ${line}` },
      });
    });
    if (!handle) {
      throw new Error(
        'No .sideboard/settings.toml (or .conductor/settings.toml) run script found — testing hook is a no-op',
      );
    }
    this.processes.set(`${thread.id}:dev`, {
      kind: 'dev',
      pid: handle.pid,
      startedAt: new Date().toISOString(),
      kill: handle.kill,
    });
    updateThread(thread.id, { devPort: handle.port });
    this.emit({ type: 'dev_server_started', threadId: thread.id, port: handle.port });
    void handle.done.then(() => {
      this.processes.delete(`${thread.id}:dev`);
      updateThread(thread.id, { devPort: null });
      this.emit({ type: 'dev_server_stopped', threadId: thread.id });
    });
    return { port: handle.port };
  }

  stopDev(threadRef: string): void {
    const thread = this.requireThread(threadRef);
    const proc = this.processes.get(`${thread.id}:dev`);
    if (proc) proc.kill();
    this.processes.delete(`${thread.id}:dev`);
    updateThread(thread.id, { devPort: null });
    this.emit({ type: 'dev_server_stopped', threadId: thread.id });
  }

  async runSetup(threadRef: string): Promise<{ exitCode: number | null }> {
    const thread = this.requireThread(threadRef);
    const key = `${thread.id}:setup`;
    if (this.processes.has(key)) {
      throw new Error('Setup already running for this thread');
    }

    this.processes.set(key, {
      kind: 'dev',
      startedAt: new Date().toISOString(),
      kill: () => {
        // setup scripts are short-lived; no cancel hook yet
      },
    });
    this.emit({ type: 'setup_started', threadId: thread.id });

    try {
      const setup = await runSetupScript(thread.repoPath, thread.worktreePath, (line) => {
        this.emit({ type: 'setup_output', threadId: thread.id, line });
      });
      if (!setup.ran) {
        throw new Error(
          'No setup script in .sideboard/settings.toml (or .conductor/settings.toml)',
        );
      }
      if (setup.exitCode !== 0 && setup.exitCode !== null) {
        updateThread(thread.id, {
          lastError: `Setup exited ${setup.exitCode}`,
        });
      }
      this.emit({ type: 'setup_finished', threadId: thread.id, exitCode: setup.exitCode });
      return { exitCode: setup.exitCode };
    } finally {
      this.processes.delete(key);
    }
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

  async diff(
    threadRef: string,
    opts?: { scope?: DiffScope; commitSha?: string | null },
  ) {
    const thread = this.requireThread(threadRef);
    return getDiff(thread.worktreePath, thread.repoPath, {
      scope: opts?.scope,
      commitSha: opts?.commitSha,
      lastTurnBase: this.turnBaselines.get(thread.id) ?? null,
    });
  }

  async diffSummary(threadRef: string) {
    const thread = this.requireThread(threadRef);
    return getDiffSummary(thread.worktreePath, thread.repoPath);
  }

  async initializeGit(threadRef: string): Promise<void> {
    const thread = this.requireThread(threadRef);
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
    return previewLand(this.requireThread(threadRef));
  }

  async confirmLand(threadRef: string, opts?: { draft?: boolean; web?: boolean }) {
    const thread = this.requireThread(threadRef);
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

  async getPrChecks(threadRef: string): Promise<PrCheckRun[]> {
    const { selector, cwd } = await this.withPrSelector(threadRef);
    if (!selector) return [];
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
    const siblings = threadsSharingWorktree(thread.worktreePath).filter((t) => t.id !== thread.id);
    // Only tear down the worktree when this is the last active chat tab.
    if (siblings.length === 0) {
      this.stopDev(thread.id);
      await removeWorktree(thread.repoPath, thread.worktreePath);
    }
    return setStatus(thread.id, 'archived');
  }

  async purge(threadRef: string, opts?: { deleteBranch?: boolean }): Promise<void> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id);
    const siblings = threadsSharingWorktree(thread.worktreePath).filter((t) => t.id !== thread.id);
    if (siblings.length === 0) {
      this.stopDev(thread.id);
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
  repoPath: string;
  autonomy?: Thread['autonomy'];
  model?: string | null;
  fast?: boolean;
  planMode?: boolean;
  attachments?: Thread['attachments'];
}): Promise<Thread> {
  const { titleFromPrompt } = await import('../threads/title.js');
  // Explicit title so orchestration shows the goal (userSetTitle via createThread).
  const title = titleFromPrompt(opts.goal) || 'Orchestration';
  const createOpts = {
    agent: opts.agent,
    repoPath: opts.repoPath,
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
    // Orchestration threads don't need a worktree for the coordinator itself —
    // store a lightweight record without worktree when possible.
    // Fallback: create off resolved default branch name.
    const { resolveDefaultBranch, resolveRepoRoot } = await import('../git/worktree.js');
    const repo = await resolveRepoRoot(opts.repoPath);
    const def = await resolveDefaultBranch(repo);
    return createThread({
      sourceType: 'branch',
      sourceRef: def,
      ...createOpts,
      repoPath: repo,
    });
  });

  // Mark as orchestration source
  const { updateThread: upd } = await import('../store/thread-store.js');
  return upd(thread.id, {
    sourceType: 'orchestration',
    sourceRef: opts.goal,
  });
}
