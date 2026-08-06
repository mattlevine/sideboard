import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.stop force-stop', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-stop-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
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
});
