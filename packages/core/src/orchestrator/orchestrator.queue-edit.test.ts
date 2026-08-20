import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readThread, createEmptyThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator queued-message editing', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-queue-edit-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThread(queue: string[]) {
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

  it('edits the text of a queued message by index', async () => {
    const thread = seedThread(['first', 'second']);
    const orch = new Orchestrator();
    const updated = await orch.editQueuedMessage(thread.id, 1, '  second (edited)  ');
    expect(updated.queue).toEqual(['first', 'second (edited)']);
    expect(readThread(thread.id)?.queue).toEqual(['first', 'second (edited)']);
  });

  it('ignores an edit with an out-of-range index', async () => {
    const thread = seedThread(['only']);
    const orch = new Orchestrator();
    const updated = await orch.editQueuedMessage(thread.id, 5, 'nope');
    expect(updated.queue).toEqual(['only']);
  });

  it('ignores an edit that trims to empty', async () => {
    const thread = seedThread(['only']);
    const orch = new Orchestrator();
    const updated = await orch.editQueuedMessage(thread.id, 0, '   ');
    expect(updated.queue).toEqual(['only']);
  });

  it('removes a queued message by index', async () => {
    const thread = seedThread(['first', 'second', 'third']);
    const orch = new Orchestrator();
    const updated = await orch.removeQueuedMessage(thread.id, 1);
    expect(updated.queue).toEqual(['first', 'third']);
  });

  it('drops status back to idle when the last queued message is removed and nothing is in flight', async () => {
    const thread = seedThread(['only']);
    const orch = new Orchestrator();
    const updated = await orch.removeQueuedMessage(thread.id, 0);
    expect(updated.queue).toEqual([]);
    expect(updated.status).toBe('idle');
  });

  it('promotes a queued message to the front and triggers drain when nothing is in flight', async () => {
    const thread = seedThread(['first', 'second', 'third']);
    const orch = new Orchestrator();
    // Stub out the actual drain (which would spawn a real agent process) —
    // only the reorder + "did it try to drain" behavior is under test here.
    const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;

    const updated = await orch.sendQueuedMessageNow(thread.id, 2);
    expect(updated.queue).toEqual(['third', 'first', 'second']);
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('stops the in-flight turn (without clearing the rest of the queue) when promoting a queued message', async () => {
    const thread = seedThread(['first', 'second']);
    const orch = new Orchestrator();
    const kill = vi.fn();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      startingTurns: Set<string>;
      drainQueue: (id: string) => Promise<void>;
    };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill,
      done: new Promise(() => {}),
    });

    const updated = await orch.sendQueuedMessageNow(thread.id, 1);
    expect(kill).toHaveBeenCalledOnce();
    expect(updated.queue).toEqual(['second', 'first']);
    expect(updated.status).toBe('stopped');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('does not drain send() when another live process is the desktop host', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      writeFileSync(join(dataDir, 'desktop-host.pid'), `${child.pid}\n`);
      const thread = seedThread([]);
      const idle = readThread(thread.id)!;
      idle.status = 'idle';
      writeThread(idle);
      const orch = new Orchestrator();
      const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
      const drainQueue = vi.fn().mockResolvedValue(undefined);
      internal.drainQueue = drainQueue;

      const updated = await orch.send(thread.id, 'hello');
      expect(updated.queue).toEqual(['hello']);
      expect(updated.status).toBe('queued');
      expect(drainQueue).not.toHaveBeenCalled();
    } finally {
      child.kill();
    }
  });

  it('drains send() when this process is the desktop host', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seedThread([]);
    const idle = readThread(thread.id)!;
    idle.status = 'idle';
    writeThread(idle);
    const orch = new Orchestrator();
    const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;

    await orch.send(thread.id, 'hello');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('drainQueue SIGKILLs a wedged agentPid instead of waiting forever', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
      { stdio: 'ignore' },
    );
    try {
      const thread = seedThread(['follow-up']);
      const live = readThread(thread.id)!;
      live.agentPid = child.pid!;
      writeThread(live);
      const orch = new Orchestrator();
      const internal = orch as unknown as {
        drainQueue: (id: string) => Promise<void>;
        runTurn: (id: string, prompt: string) => Promise<void>;
      };
      const runTurn = vi.fn().mockResolvedValue(undefined);
      internal.runTurn = runTurn;

      await internal.drainQueue(thread.id);
      expect(runTurn).toHaveBeenCalledWith(thread.id, 'follow-up');
      expect(readThread(thread.id)?.agentPid).toBeNull();
      expect(() => process.kill(child.pid!, 0)).toThrow();
    } finally {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
  });

  it('Send now SIGTERMs a foreign live agentPid and then drains', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      const thread = seedThread(['follow-up']);
      const live = readThread(thread.id)!;
      live.agentPid = child.pid!;
      live.status = 'running';
      writeThread(live);
      const orch = new Orchestrator();
      const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
      const drainQueue = vi.fn().mockResolvedValue(undefined);
      internal.drainQueue = drainQueue;

      const updated = await orch.sendQueuedMessageNow(thread.id, 0);
      expect(drainQueue).toHaveBeenCalledWith(thread.id);
      expect(updated.status).toBe('stopped');
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
