import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { Orchestrator } from './orchestrator.js';
import { resetChildHaltNotifications } from './child-halt.js';

describe('Orchestrator.stop force-stop', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-stop-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetChildHaltNotifications();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThread(queue: string[] = ['next-prompt', 'another']) {
    const thread = createEmptyThread({
      title: 'Test',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/test',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      queue,
      status: 'queued',
    });
    writeThread(thread);
    return thread;
  }

  it('clears the prompt queue by default (force-stop)', () => {
    const thread = seedThread();
    const orch = new Orchestrator();
    const stopped = orch.stop(thread.id);
    expect(stopped.status).toBe('stopped');
    expect(stopped.queue).toEqual([]);
    expect(readThread(thread.id)?.queue).toEqual([]);
  });

  it('preserves the queue when clearQueue is false', () => {
    const thread = seedThread(['keep-me']);
    const orch = new Orchestrator();
    const stopped = orch.stop(thread.id, { clearQueue: false });
    expect(stopped.status).toBe('stopped');
    expect(stopped.queue).toEqual(['keep-me']);
  });

  it('halts drain when preserving the queue so the next prompt does not auto-start', async () => {
    const thread = seedThread(['next-prompt']);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      haltDrain: Set<string>;
      draining: Set<string>;
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      startingTurns: Set<string>;
      drainQueue: (id: string) => Promise<void>;
    };

    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill: () => resolveDone(),
      done: done.then(() => ({
        exitCode: 143,
        sessionId: null,
        assistantText: '',
        parts: [],
        usage: null,
      })),
    });
    internal.startingTurns.add(thread.id);
    internal.draining.add(thread.id);

    orch.stop(thread.id, { clearQueue: false });
    expect(internal.haltDrain.has(thread.id)).toBe(true);
    expect(readThread(thread.id)?.queue).toEqual(['next-prompt']);

    // Simulate drain loop checking halt after the turn unwinds.
    internal.activeTurns.delete(thread.id);
    internal.startingTurns.delete(thread.id);
    internal.draining.delete(thread.id);
    await internal.drainQueue(thread.id);
    expect(readThread(thread.id)?.queue).toEqual(['next-prompt']);
    expect(readThread(thread.id)?.status).toBe('stopped');
  });

  it('continues the queue when continueQueue is true (Send now)', () => {
    const thread = seedThread(['keep-me']);
    const orch = new Orchestrator();
    const internal = orch as unknown as { haltDrain: Set<string> };
    internal.haltDrain.add(thread.id);
    orch.stop(thread.id, { clearQueue: false, continueQueue: true });
    expect(internal.haltDrain.has(thread.id)).toBe(false);
    expect(readThread(thread.id)?.queue).toEqual(['keep-me']);
  });

  it('marks stoppedTurns and kills the in-flight handle', () => {
    const thread = seedThread(['queued-after']);
    const orch = new Orchestrator();
    const kill = vi.fn();
    let resolveDone!: (value: {
      exitCode: number | null;
      sessionId: string | null;
      assistantText: string;
      parts: [];
      usage: null;
    }) => void;
    const done = new Promise<{
      exitCode: number | null;
      sessionId: string | null;
      assistantText: string;
      parts: [];
      usage: null;
    }>((resolve) => {
      resolveDone = resolve;
    });
    // Private fields — compile-time only; used to simulate an in-flight turn.
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: typeof done }>;
      startingTurns: Set<string>;
      stoppedTurns: Set<string>;
    };
    internal.activeTurns.set(thread.id, {
      pid: 42,
      kill: () => {
        kill();
        resolveDone({
          exitCode: 143,
          sessionId: null,
          assistantText: '',
          parts: [],
          usage: null,
        });
      },
      done,
    });
    internal.startingTurns.add(thread.id);

    const stopped = orch.stop(thread.id);
    expect(kill).toHaveBeenCalledOnce();
    expect(stopped.status).toBe('stopped');
    expect(stopped.queue).toEqual([]);
    expect(internal.stoppedTurns.has(thread.id)).toBe(true);
  });

  function seedOrchChild() {
    mkdirSync(join(dataDir, 'global'), { recursive: true });
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
    const parent = createEmptyThread({
      title: 'San Lorenzo',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'cursor',
    });
    writeThread(parent);
    const child = createEmptyThread({
      title: 'Review PR',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/review',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      parentThreadId: parent.id,
    });
    writeThread(child);
    return { parent, child };
  }

  it('does not tell the parent that an idle stop was a mid-turn death', async () => {
    const { parent, child } = seedOrchChild();
    const orch = new Orchestrator();
    const send = vi.spyOn(orch, 'send').mockResolvedValue(readThread(parent.id)!);
    orch.stop(child.id);
    expect(send).not.toHaveBeenCalled();
  });

  it('notifies the parent only when a live turn is force-stopped', async () => {
    const { parent, child } = seedOrchChild();
    const orch = new Orchestrator();
    const send = vi.spyOn(orch, 'send').mockResolvedValue(readThread(parent.id)!);
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
    };
    internal.activeTurns.set(child.id, {
      pid: 1,
      kill: () => undefined,
      done: Promise.resolve({
        exitCode: 143,
        sessionId: null,
        assistantText: '',
        parts: [],
        usage: null,
      }),
    });
    orch.stop(child.id);
    expect(send).toHaveBeenCalledOnce();
    expect(String(send.mock.calls[0]?.[1])).toContain('stopped before finishing');
  });

  it('does not notify the parent when MCP force_stop already owns the interrupt', () => {
    const { child } = seedOrchChild();
    const orch = new Orchestrator();
    const send = vi.spyOn(orch, 'send');
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
    };
    internal.activeTurns.set(child.id, {
      pid: 1,
      kill: () => undefined,
      done: Promise.resolve({
        exitCode: 143,
        sessionId: null,
        assistantText: '',
        parts: [],
        usage: null,
      }),
    });
    orch.stop(child.id, { notifyParent: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not sticky-mark when nothing is in flight', () => {
    const thread = seedThread(['a']);
    const orch = new Orchestrator();
    orch.stop(thread.id);
    const internal = orch as unknown as { stoppedTurns: Set<string> };
    expect(internal.stoppedTurns.has(thread.id)).toBe(false);
    expect(readThread(thread.id)?.status).toBe('stopped');
    expect(readThread(thread.id)?.queue).toEqual([]);
  });

  it('emits empty queue_changed when clearing', () => {
    const thread = seedThread(['x']);
    const orch = new Orchestrator();
    const events: Array<{ type: string; queue?: string[] }> = [];
    orch.on((e) => {
      if (e.type === 'queue_changed' || e.type === 'status_changed') {
        events.push(e as { type: string; queue?: string[] });
      }
    });
    orch.stop(thread.id);
    expect(events.some((e) => e.type === 'queue_changed' && e.queue?.length === 0)).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'status_changed')).toBe(true);
  });

  it('does not un-archive a thread when stop runs after archive', async () => {
    const thread = seedThread(['next']);
    const orch = new Orchestrator();
    await orch.archive(thread.id);
    expect(readThread(thread.id)?.status).toBe('archived');
    orch.stop(thread.id);
    expect(readThread(thread.id)?.status).toBe('archived');
  });

  it('SIGTERMs a live agentPid when this process has no turn handle', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      const thread = seedThread([]);
      const live = readThread(thread.id)!;
      live.agentPid = child.pid!;
      live.status = 'running';
      writeThread(live);
      const orch = new Orchestrator();
      orch.stop(thread.id, { clearQueue: false });
      await vi.waitFor(() => {
        expect(() => process.kill(child.pid!, 0)).toThrow();
      });
    } finally {
      try {
        child.kill();
      } catch {
        // already dead
      }
    }
  });
});
