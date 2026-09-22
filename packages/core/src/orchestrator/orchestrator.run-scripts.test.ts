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

  it('stops Run scripts when the worktree connects a different PR', async () => {
    const worktreePath = join(dataDir, 'wt-retarget');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Retarget',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/retarget',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status: 'idle',
    });
    thread.prUrl = 'https://github.com/acme/app/pull/9';
    thread.prState = 'MERGED';
    thread.activeRuns = [
      {
        scriptName: 'dev',
        port: 41300,
        ports: [41300],
        startedAt: new Date().toISOString(),
      },
    ];
    thread.devPort = 41300;
    writeThread(thread);

    const orch = new Orchestrator();
    const internal = orch as unknown as {
      processes: Map<string, { kind: string; kill: () => void; startedAt: string }>;
      persistPrMetaAndMaybeArchive: (
        t: typeof thread,
        meta: {
          number: number;
          title: string;
          url: string;
          state: string;
          isDraft: boolean;
          reviewDecision: null;
          baseRefName: string;
          headRefName: string;
          isInMergeQueue: boolean;
          mergeable: null;
          mergeStateStatus: null;
        },
      ) => Promise<void>;
    };
    let killed = false;
    internal.processes.set(`wt:${worktreePath}:run:dev`, {
      kind: 'dev',
      startedAt: new Date().toISOString(),
      kill: () => {
        killed = true;
      },
    });

    await internal.persistPrMetaAndMaybeArchive(thread, {
      number: 22,
      title: 'Next',
      url: 'https://github.com/acme/app/pull/22',
      state: 'OPEN',
      isDraft: true,
      reviewDecision: null,
      baseRefName: 'main',
      headRefName: 'thread/retarget',
      isInMergeQueue: false,
      mergeable: null,
      mergeStateStatus: null,
    });

    expect(killed).toBe(true);
    expect(readThread(thread.id)?.activeRuns).toEqual([]);
    expect(readThread(thread.id)?.devPort).toBeNull();
    expect(readThread(thread.id)?.prUrl).toBe('https://github.com/acme/app/pull/22');
  });

  it('does not stop Run scripts on same-PR state updates', async () => {
    const thread = seedThreadWithRun(41301);
    const live = readThread(thread.id)!;
    live.prUrl = 'https://github.com/acme/app/pull/9';
    live.prState = 'OPEN';
    writeThread(live);

    const orch = new Orchestrator();
    const internal = orch as unknown as {
      processes: Map<string, { kind: string; kill: () => void; startedAt: string }>;
      persistPrMetaAndMaybeArchive: (
        t: typeof live,
        meta: {
          number: number;
          title: string;
          url: string;
          state: string;
          isDraft: boolean;
          reviewDecision: null;
          baseRefName: string;
          headRefName: string;
          isInMergeQueue: boolean;
          mergeable: null;
          mergeStateStatus: null;
        },
      ) => Promise<void>;
    };
    let killed = false;
    internal.processes.set(`wt:${live.worktreePath}:run:dev`, {
      kind: 'dev',
      startedAt: new Date().toISOString(),
      kill: () => {
        killed = true;
      },
    });

    await internal.persistPrMetaAndMaybeArchive(live, {
      number: 9,
      title: live.title,
      url: 'https://github.com/acme/app/pull/9',
      state: 'MERGED',
      isDraft: false,
      reviewDecision: null,
      baseRefName: 'main',
      headRefName: live.branchName,
      isInMergeQueue: false,
      mergeable: null,
      mergeStateStatus: null,
    });

    expect(killed).toBe(false);
    expect(readThread(live.id)?.activeRuns).toHaveLength(1);
    expect(readThread(live.id)?.prState).toBe('MERGED');
  });
});

describe('Orchestrator startDev coalescing', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-start-dev-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('coalesces concurrent startDev calls onto one spawn', async () => {
    const worktreePath = join(dataDir, 'wt');
    const repoPath = join(dataDir, 'repo');
    mkdirSync(join(worktreePath, '.sideboard'), { recursive: true });
    mkdirSync(repoPath, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(worktreePath, '.sideboard', 'settings.toml'),
      `[scripts.run.dev]\ncommand = "sleep 30"\ndefault = true\n`,
    );
    const thread = createEmptyThread({
      title: 'Start coalesce',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/start-coalesce',
      worktreePath,
      repoPath,
      agent: 'claude',
      status: 'idle',
    });
    writeThread(thread);

    const conductor = await import('../hook/conductor.js');
    let spawns = 0;
    vi.spyOn(conductor, 'startDevServer').mockImplementation(async () => {
      spawns += 1;
      await new Promise((r) => setTimeout(r, 40));
      return {
        pid: 1,
        port: 41999,
        ports: [41999],
        scriptName: 'dev',
        kill: () => undefined,
        done: new Promise(() => undefined),
      };
    });

    const orch = new Orchestrator();
    const [a, b] = await Promise.all([
      orch.startDev(thread.id, 'dev'),
      orch.startDev(thread.id, 'dev'),
    ]);
    expect(a.port).toBe(41999);
    expect(b.port).toBe(41999);
    expect(spawns).toBe(1);
    orch.stopDev(thread.id, 'dev');
  });

  it('clears stale activeRuns without a handle before spawning', async () => {
    const worktreePath = join(dataDir, 'wt-stale');
    const repoPath = join(dataDir, 'repo-stale');
    mkdirSync(join(worktreePath, '.sideboard'), { recursive: true });
    mkdirSync(repoPath, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(worktreePath, '.sideboard', 'settings.toml'),
      `[scripts.run.dev]\ncommand = "sleep 30"\ndefault = true\n`,
    );
    const thread = createEmptyThread({
      title: 'Stale run',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/stale-run',
      worktreePath,
      repoPath,
      agent: 'claude',
      status: 'idle',
    });
    thread.activeRuns = [
      {
        scriptName: 'dev',
        port: 41888,
        ports: [41888],
        startedAt: new Date().toISOString(),
      },
    ];
    thread.devPort = 41888;
    writeThread(thread);

    const conductor = await import('../hook/conductor.js');
    const killSpy = vi.spyOn(conductor, 'killListenersOnPorts').mockImplementation(() => undefined);
    vi.spyOn(conductor, 'startDevServer').mockResolvedValue({
      pid: 2,
      port: 41889,
      ports: [41889],
      scriptName: 'dev',
      kill: () => undefined,
      done: new Promise(() => undefined),
    });

    const orch = new Orchestrator();
    const result = await orch.startDev(thread.id, 'dev');
    expect(killSpy).toHaveBeenCalledWith([41888]);
    expect(result.port).toBe(41889);
    expect(readThread(thread.id)?.devPort).toBe(41889);
    orch.stopDev(thread.id, 'dev');
  });
});
