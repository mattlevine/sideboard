import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import { isPidAlive, Orchestrator } from './orchestrator.js';

describe('Orchestrator.reconcile reclaim', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-reconcile-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedRunning(agentPid: number | null) {
    const worktreePath = join(dataDir, 'wt');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Live',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/live',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'running',
    });
    thread.agentPid = agentPid;
    writeThread(thread);
    return thread;
  }

  it('isPidAlive detects this process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });

  it('does not reclaim by default (MCP-safe)', async () => {
    const thread = seedRunning(null);
    const orch = new Orchestrator();
    await orch.reconcile();
    expect(readThread(thread.id)?.status).toBe('running');
    expect(readThread(thread.id)?.lastError).toBeNull();
  });

  it('reclaims dead turns on explicit startup reclaim', async () => {
    const thread = seedRunning(null);
    const orch = new Orchestrator();
    await orch.reconcile(undefined, { reclaimStaleTurns: true });
    const next = readThread(thread.id)!;
    expect(next.status).toBe('stopped');
    expect(next.lastError).toContain('reconciled on startup');
  });

  it('does not reclaim when agentPid is still alive', async () => {
    const thread = seedRunning(process.pid);
    const orch = new Orchestrator();
    await orch.reconcile(undefined, { reclaimStaleTurns: true });
    const next = readThread(thread.id)!;
    expect(next.status).toBe('running');
    expect(next.lastError).toBeNull();
  });

  it('skips draining persisted queues when drainQueues is false', async () => {
    const worktreePath = join(dataDir, 'wt-q');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Queued',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/queued',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'queued',
    });
    thread.queue = ['review this pr'];
    writeThread(thread);

    const orch = new Orchestrator();
    const drainSpy = vi.spyOn(
      orch as unknown as { drainQueue: (id: string) => Promise<void> },
      'drainQueue',
    );
    await orch.reconcile(undefined, { drainQueues: false });
    expect(drainSpy).not.toHaveBeenCalled();
    expect(readThread(thread.id)?.status).toBe('queued');
    expect(readThread(thread.id)?.queue).toEqual(['review this pr']);
    drainSpy.mockRestore();
  });

  it('adoptPersistedQueues heals queued+empty and drains non-empty queues', async () => {
    const emptyPath = join(dataDir, 'wt-empty');
    const queuedPath = join(dataDir, 'wt-queued');
    mkdirSync(emptyPath, { recursive: true });
    mkdirSync(queuedPath, { recursive: true });

    const emptyQueued = createEmptyThread({
      title: 'Empty queued',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/empty-q',
      worktreePath: emptyPath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'queued',
    });
    emptyQueued.queue = [];
    emptyQueued.agentPid = 999_999_999; // dead
    writeThread(emptyQueued);

    const withQueue = createEmptyThread({
      title: 'Has queue',
      sourceType: 'pr',
      sourceRef: '69',
      branchName: 'thread/has-q',
      worktreePath: queuedPath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'queued',
    });
    withQueue.queue = ['Review PR #69'];
    writeThread(withQueue);

    const orch = new Orchestrator();
    const drainSpy = vi.spyOn(
      orch as unknown as { drainQueue: (id: string) => Promise<void> },
      'drainQueue',
    ).mockResolvedValue(undefined);

    orch.adoptPersistedQueues();

    expect(readThread(emptyQueued.id)?.status).toBe('idle');
    expect(readThread(emptyQueued.id)?.agentPid).toBeNull();
    expect(drainSpy).toHaveBeenCalledWith(withQueue.id);
    drainSpy.mockRestore();
  });
});
