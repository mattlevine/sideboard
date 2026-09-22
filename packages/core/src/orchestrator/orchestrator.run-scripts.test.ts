import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator run-script orphan reclaim', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-run-orphan-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThreadWithRun(port: number) {
    const worktreePath = join(dataDir, 'wt');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Run orphan',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/run-orphan',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'idle',
    });
    thread.activeRuns = [
      {
        scriptName: 'dev',
        port,
        ports: [port, port + 1],
        startedAt: new Date().toISOString(),
      },
    ];
    thread.devPort = port;
    writeThread(thread);
    return thread;
  }

  it('reaps stale activeRuns on startup reclaim', async () => {
    const thread = seedThreadWithRun(41234);
    const orch = new Orchestrator();
    await orch.reconcile(undefined, { reclaimStaleTurns: true, drainQueues: false });

    const next = readThread(thread.id)!;
    expect(next.activeRuns).toEqual([]);
    expect(next.devPort).toBeNull();
  });

  it('stopDev clears persisted runs when no in-memory process handle exists', () => {
    const thread = seedThreadWithRun(41235);
    const orch = new Orchestrator();
    orch.stopDev(thread.id, 'dev');

    const next = readThread(thread.id)!;
    expect(next.activeRuns).toEqual([]);
    expect(next.devPort).toBeNull();
  });

  it('skips non-force reap when a live handle still owns the run', () => {
    const thread = seedThreadWithRun(41200);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      processes: Map<string, { kind: string; kill: () => void; startedAt: string }>;
    };
    let killed = false;
    internal.processes.set(`wt:${thread.worktreePath}:run:dev`, {
      kind: 'dev',
      startedAt: new Date().toISOString(),
      kill: () => {
        killed = true;
      },
    });

    orch.reapOrphanedRunScripts();
    expect(killed).toBe(false);
    expect(readThread(thread.id)?.activeRuns).toHaveLength(1);
  });

  it('stopAllRunScripts kills handles and clears persisted activeRuns', () => {
    const thread = seedThreadWithRun(41201);
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      processes: Map<string, { kind: string; kill: () => void; startedAt: string }>;
    };
    let killed = false;
    internal.processes.set(`wt:${thread.worktreePath}:run:dev`, {
      kind: 'dev',
      startedAt: new Date().toISOString(),
      kill: () => {
        killed = true;
      },
    });

    orch.stopAllRunScripts();
    expect(killed).toBe(true);
    expect(internal.processes.size).toBe(0);
    expect(readThread(thread.id)?.activeRuns).toEqual([]);
    expect(readThread(thread.id)?.devPort).toBeNull();
  });
});
