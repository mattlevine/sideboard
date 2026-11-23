import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('join send', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-join-send-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('queues behind a spawned turn without rewriting the running prompt', async () => {
    writeFileSync(join(dataDir, 'desktop-host.pid'), `${process.pid}\n`);
    const thread = createEmptyThread({
      title: 'Test',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/test',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      queue: ['later'],
      status: 'running',
    });
    thread.messages = [{ role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' }];
    writeThread(thread);
    const orch = new Orchestrator();
    const kill = vi.fn();
    const internal = orch as unknown as {
      activeTurns: Map<string, { pid: number; kill: () => void; done: Promise<unknown> }>;
      openSteerPrompt: Map<string, { text: string; spawned: boolean }>;
      drainQueue: (id: string) => Promise<void>;
    };
    const drainQueue = vi.fn().mockResolvedValue(undefined);
    internal.drainQueue = drainQueue;
    internal.openSteerPrompt.set(thread.id, { text: 'Work on issue A', spawned: true });
    internal.activeTurns.set(thread.id, { pid: 1, kill, done: new Promise(() => {}) });

    const updated = await orch.send(thread.id, 'And B', { followUp: 'join' });
    expect(kill).not.toHaveBeenCalled();
    expect(updated.queue).toEqual(['later', 'And B']);
    expect(readThread(thread.id)?.messages.at(-1)?.text).toBe('Work on issue A');
    expect(internal.openSteerPrompt.get(thread.id)?.text).toBe('Work on issue A');
    expect(drainQueue).toHaveBeenCalledWith(thread.id);
  });
});
