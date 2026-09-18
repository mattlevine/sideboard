import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readThread, createEmptyThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { updateAdvancedSettings } from '../store/app-settings.js';
import { Orchestrator, resolveOrchChildFollowUp, resolveSendFollowUp } from './orchestrator.js';

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

  function seedOrch(queue: string[] = []) {
    mkdirSync(join(dataDir, 'global'), { recursive: true });
    const thread = createEmptyThread({
      title: 'Orch',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'claude',
      queue,
      status: queue.length ? 'queued' : 'idle',
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

  it('clears composer attachments on send so the image chip does not linger', async () => {
    const thread = seedThread([]);
    const idle = readThread(thread.id)!;
    idle.status = 'idle';
    idle.attachments = [
      {
        id: 'img-1',
        name: 'shot.png',
        kind: 'file',
        content: 'Image attached: shot.png',
        previewDataUrl: 'data:image/png;base64,xx',
      },
    ];
    writeThread(idle);
    const orch = new Orchestrator();
    const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
    internal.drainQueue = vi.fn().mockResolvedValue(undefined);

    const updated = await orch.send(thread.id, 'look at this screenshot');
    expect(updated.attachments).toEqual([]);
    expect(updated.queueAttachments).toEqual([
      [expect.objectContaining({ id: 'img-1', name: 'shot.png' })],
    ]);
    expect(updated.pendingTurnAttachments).toEqual([]);
    expect(readThread(thread.id)?.attachments).toEqual([]);
  });

  it('drops parked images when the queued prompt that owned them is removed', async () => {
    const thread = seedThread([]);
    const idle = readThread(thread.id)!;
    idle.status = 'running';
    idle.attachments = [
      {
        id: 'img-1',
        name: 'shot.png',
        kind: 'file',
        content: 'Image attached: shot.png',
        previewDataUrl: 'data:image/png;base64,xx',
      },
    ];
    writeThread(idle);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      drainQueue: (id: string) => Promise<void>;
    };
    internal.drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill: vi.fn(),
      done: new Promise(() => {}),
    });

    const sent = await orch.send(thread.id, 'look at this screenshot');
    expect(sent.queue).toEqual(['look at this screenshot']);
    expect(sent.queueAttachments).toEqual([
      [expect.objectContaining({ id: 'img-1', name: 'shot.png' })],
    ]);

    const updated = await orch.removeQueuedMessage(thread.id, 0);
    expect(updated.queue).toEqual([]);
    expect(updated.queueAttachments).toEqual([]);
    expect(updated.pendingTurnAttachments).toEqual([]);
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

  it('prepends a crash-continue prompt so the agent can recover', async () => {
    const thread = seedThread(['later']);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      maybeEnqueueCrashContinue: (
        id: string,
        opts: { detail: string; assistantText: string; partsCount: number },
      ) => void;
      crashContinued: Set<string>;
    };
    internal.maybeEnqueueCrashContinue(thread.id, {
      detail: 'Cursor runner crashed in Node. Retry the turn.',
      assistantText: '',
      partsCount: 0,
    });
    const after = readThread(thread.id)!;
    expect(after.queue[0]).toMatch(/Continue from where you left off/);
    expect(after.queue[1]).toBe('later');
    expect(internal.crashContinued.has(thread.id)).toBe(true);

    internal.maybeEnqueueCrashContinue(thread.id, {
      detail: 'Cursor runner crashed in Node. Retry the turn.',
      assistantText: '',
      partsCount: 0,
    });
    expect(readThread(thread.id)?.queue).toHaveLength(2);
  });

  it('does not auto-continue auth or quota failures', async () => {
    const thread = seedThread([]);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      maybeEnqueueCrashContinue: (
        id: string,
        opts: { detail: string; assistantText: string; partsCount: number },
      ) => void;
    };
    internal.maybeEnqueueCrashContinue(thread.id, {
      detail: "You've hit your session limit · resets 7:10pm",
      assistantText: '',
      partsCount: 0,
    });
    expect(readThread(thread.id)?.queue).toEqual([]);
  });

  it('prepends a job-continue prompt when a detached job is still running', () => {
    const thread = seedThread([]);
    const jobDir = join(thread.worktreePath, '.context', '.sideboard', 'detached-jobs', 'core-test');
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, 'pid'), `${process.pid}\n`);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      maybeEnqueueJobContinue: (id: string, chatText: string) => void;
      jobContinueCount: Map<string, number>;
    };
    internal.maybeEnqueueJobContinue(thread.id, "I'll let you know when they're done.");
    const after = readThread(thread.id)!;
    expect(after.queue[0]).toMatch(/wait_for_job/);
    expect(internal.jobContinueCount.get(thread.id)).toBe(1);
  });

  it('nudges once when the agent promised later with no running job', () => {
    const thread = seedThread([]);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      maybeEnqueueJobContinue: (id: string, chatText: string) => void;
      jobContinueNudged: Set<string>;
    };
    internal.maybeEnqueueJobContinue(thread.id, "I'll let you know when the tests are done.");
    expect(readThread(thread.id)?.queue[0]).toMatch(/no detached job/i);
    internal.maybeEnqueueJobContinue(thread.id, "I'll let you know when the tests are done.");
    expect(readThread(thread.id)?.queue).toHaveLength(1);
  });

  it('resolves omitted follow-up: worktrees queue, orchestrators use the setting', () => {
    const worktree = seedThread([]);
    const orch = seedOrch();
    expect(resolveSendFollowUp(worktree)).toBe('queue');
    expect(resolveSendFollowUp(orch)).toBe('steer');
    expect(resolveSendFollowUp(orch, 'queue')).toBe('queue');
    expect(resolveSendFollowUp(worktree, 'steer')).toBe('steer');
    expect(resolveOrchChildFollowUp()).toBe('steer');
    expect(resolveOrchChildFollowUp('queue')).toBe('queue');
    updateAdvancedSettings({ followUpBehavior: 'queue' });
    expect(resolveSendFollowUp(orch)).toBe('queue');
    expect(resolveSendFollowUp(worktree)).toBe('queue');
    expect(resolveOrchChildFollowUp()).toBe('queue');
  });

  it('steers an omitted follow-up on a busy orchestrator (default setting)', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seedOrch(['later']);
    const live = readThread(thread.id)!;
    live.status = 'running';
    writeThread(live);
    const orch = new Orchestrator();
    const kill = vi.fn();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      drainQueue: (id: string) => Promise<void>;
    };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill,
      done: new Promise(() => {}),
    });

    const updated = await orch.send(
      thread.id,
      'Sideboard: child worktree [Fix](sideboard://thread/abc) stopped before finishing (status=stopped).',
    );
    expect(kill).toHaveBeenCalledOnce();
    expect(updated.queue[0]).toMatch(/^Sideboard:/);
    expect(updated.queue).toContain('later');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('queues an omitted follow-up on a busy orchestrator when the setting is queue', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    updateAdvancedSettings({ followUpBehavior: 'queue' });
    const thread = seedOrch([]);
    const live = readThread(thread.id)!;
    live.status = 'running';
    writeThread(live);
    const orch = new Orchestrator();
    const kill = vi.fn();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      drainQueue: (id: string) => Promise<void>;
    };
    internal.drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill,
      done: new Promise(() => {}),
    });

    const updated = await orch.send(thread.id, 'Sideboard: child stopped');
    expect(kill).not.toHaveBeenCalled();
    expect(updated.queue).toEqual(['Sideboard: child stopped']);
    expect(updated.status).toBe('running');
  });

  it('keeps status running when a follow-up is queued during an in-flight turn', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seedThread([]);
    const live = readThread(thread.id)!;
    live.status = 'running';
    writeThread(live);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      drainQueue: (id: string) => Promise<void>;
    };
    internal.drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill: () => {},
      done: new Promise(() => {}),
    });

    const updated = await orch.send(thread.id, 'follow-up');
    expect(updated.queue).toEqual(['follow-up']);
    expect(updated.status).toBe('running');
  });

  it('steers a busy worktree when the orchestrator uses child follow-up', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seedThread(['later']);
    const live = readThread(thread.id)!;
    live.status = 'running';
    writeThread(live);
    const orch = new Orchestrator();
    const kill = vi.fn();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      drainQueue: (id: string) => Promise<void>;
    };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill,
      done: new Promise(() => {}),
    });

    const updated = await orch.send(thread.id, 'from orch', {
      followUp: resolveOrchChildFollowUp(),
    });
    expect(kill).toHaveBeenCalledOnce();
    expect(updated.queue[0]).toBe('from orch');
    expect(updated.queue).toContain('later');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('steers a follow-up to the front and interrupts the in-flight turn', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seedThread(['later']);
    const live = readThread(thread.id)!;
    live.status = 'running';
    writeThread(live);
    const orch = new Orchestrator();
    const kill = vi.fn();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      drainQueue: (id: string) => Promise<void>;
    };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;
    internal.activeTurns.set(thread.id, {
      pid: 1,
      kill,
      done: new Promise(() => {}),
    });

    const updated = await orch.send(thread.id, 'steer now', { followUp: 'steer' });
    expect(kill).toHaveBeenCalledOnce();
    expect(updated.queue[0]).toBe('steer now');
    expect(updated.queue).toContain('later');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('steers ahead of parked follow-ups when nothing is in flight', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = seedThread(['parked']);
    const idle = readThread(thread.id)!;
    idle.status = 'idle';
    writeThread(idle);
    const orch = new Orchestrator();
    const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;

    const updated = await orch.send(thread.id, 'steer now', { followUp: 'steer' });
    expect(updated.queue[0]).toBe('steer now');
    expect(updated.queue).toContain('parked');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });

  it('MCP steer only reorders while the desktop host owns the child (#115)', async () => {
    // Another live process is the desktop host — this one is MCP/CLI.
    const host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      writeFileSync(join(dataDir, 'desktop-host.pid'), `${host.pid}\n`);
      const thread = seedThread(['later']);
      const live = readThread(thread.id)!;
      live.status = 'running';
      live.agentPid = child.pid!;
      writeThread(live);
      const orch = new Orchestrator();
      const internal = orch as unknown as { drainQueue: (id: string) => Promise<void> };
      const drainQueue = vi.fn().mockResolvedValue(undefined);
      internal.drainQueue = drainQueue;

      const updated = await orch.send(thread.id, 'steer now', { followUp: 'steer' });
      expect(updated.queue).toEqual(['steer now', 'later']);
      expect(updated.status).toBe('running');
      expect(drainQueue).not.toHaveBeenCalled();
      // Desktop-owned child untouched.
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
    } finally {
      for (const p of [host, child]) {
        try {
          p.kill('SIGKILL');
        } catch {
          // already dead
        }
      }
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
