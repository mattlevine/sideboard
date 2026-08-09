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
});
