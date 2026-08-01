import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { spawnAgentTurn, type SpawnTurnHandle } from '../agents/spawn.js';
import { getAdapter } from '../agents/index.js';
import { listWorktrees, removeWorktree } from '../git/worktree.js';
import { startDevServer } from '../hook/conductor.js';
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
  CreateThreadInput,
  OrchestratorEvent,
  Thread,
} from '../types/thread.js';
import { createThread } from '../threads/create.js';
import {
  adoptThread,
  importConductorWorkspaceAsync,
  listConductorWorkspaces,
} from '../threads/adopt.js';
import { confirmLand, previewLand } from '../land/land.js';
import { getDiff, getDiffSummary } from '../diff/diff.js';

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
        if (wt.path.includes('/.sideboard/worktrees/') && !known.has(wt.path)) {
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
    const thread = await createThread(input, (line) => {
      this.emit({
        type: 'turn_output',
        threadId: 'pending',
        event: { type: 'stdout', data: line },
      });
    });
    this.emit({ type: 'status_changed', threadId: thread.id, status: thread.status });
    return thread;
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
    const thread = this.requireThread(threadId);
    this.runningCount += 1;
    setStatus(threadId, 'running');
    this.emit({ type: 'status_changed', threadId, status: 'running' });
    this.emit({ type: 'turn_started', threadId, prompt });
    appendMessage(threadId, {
      role: 'user',
      text: prompt,
      ts: new Date().toISOString(),
    });

    // Re-resolve session before turn
    const adapter = getAdapter(thread.agent);
    const resolved = await adapter.resolveSessionId(thread.worktreePath, thread.sessionId);
    if (resolved && resolved !== thread.sessionId) {
      updateThread(threadId, { sessionId: resolved });
    }

    const fresh = this.requireThread(threadId);
    try {
      const handle = await spawnAgentTurn(fresh, prompt, (event) => {
        this.emit({ type: 'turn_output', threadId, event });
        if (event.type === 'session_id') {
          updateThread(threadId, { sessionId: event.data });
        }
      });
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
      if (result.assistantText.trim()) {
        appendMessage(threadId, {
          role: 'agent',
          text: result.assistantText.trim(),
          ts: new Date().toISOString(),
        });
      }
      setStatus(threadId, result.exitCode === 0 ? 'idle' : 'error', result.exitCode === 0 ? null : `exit ${result.exitCode}`);
      this.emit({
        type: 'status_changed',
        threadId,
        status: result.exitCode === 0 ? 'idle' : 'error',
      });
      this.emit({ type: 'turn_finished', threadId, exitCode: result.exitCode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(threadId, 'error', message);
      this.emit({ type: 'error', threadId, message });
      this.emit({ type: 'status_changed', threadId, status: 'error' });
      this.emit({ type: 'turn_finished', threadId, exitCode: 1 });
    } finally {
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
      throw new Error('No .conductor/settings.toml run script found — testing hook is a no-op');
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

  async diff(threadRef: string) {
    const thread = this.requireThread(threadRef);
    return getDiff(thread.worktreePath, thread.repoPath);
  }

  async diffSummary(threadRef: string) {
    const thread = this.requireThread(threadRef);
    return getDiffSummary(thread.worktreePath, thread.repoPath);
  }

  async previewLand(threadRef: string) {
    return previewLand(this.requireThread(threadRef));
  }

  async confirmLand(threadRef: string) {
    const thread = this.requireThread(threadRef);
    const result = await confirmLand(thread);
    updateThread(thread.id, { prUrl: result.prUrl });
    return result;
  }

  async archive(threadRef: string): Promise<Thread> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id);
    this.stopDev(thread.id);
    await removeWorktree(thread.repoPath, thread.worktreePath);
    return setStatus(thread.id, 'archived');
  }

  async purge(threadRef: string, opts?: { deleteBranch?: boolean }): Promise<void> {
    const thread = this.requireThread(threadRef);
    this.stop(thread.id);
    this.stopDev(thread.id);
    await removeWorktree(thread.repoPath, thread.worktreePath, {
      deleteBranch: opts?.deleteBranch ? thread.branchName : undefined,
    });
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
    this.maxConcurrent = Math.max(1, n);
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
}): Promise<Thread> {
  const thread = await createThread({
    sourceType: 'branch',
    sourceRef: 'HEAD',
    agent: opts.agent,
    repoPath: opts.repoPath,
    title: `Orchestrate: ${opts.goal.slice(0, 60)}`,
  }).catch(async () => {
    // Orchestration threads don't need a worktree for the coordinator itself —
    // store a lightweight record without worktree when possible.
    // Fallback: create off default branch.
    const { resolveDefaultBranch, resolveRepoRoot } = await import('../git/worktree.js');
    const repo = await resolveRepoRoot(opts.repoPath);
    const def = await resolveDefaultBranch(repo);
    return createThread({
      sourceType: 'branch',
      sourceRef: def,
      agent: opts.agent,
      repoPath: repo,
      title: `Orchestrate: ${opts.goal.slice(0, 60)}`,
    });
  });

  // Mark as orchestration source
  const { updateThread: upd } = await import('../store/thread-store.js');
  return upd(thread.id, {
    sourceType: 'orchestration',
    sourceRef: opts.goal,
  });
}
