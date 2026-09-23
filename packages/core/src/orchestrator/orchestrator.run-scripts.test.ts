import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import type { RunScriptRequest } from '../types/thread.js';
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

  it('stopDev clears persisted runs when no in-memory process handle exists', async () => {
    const thread = seedThreadWithRun(41235);
    const orch = new Orchestrator();
    await orch.stopDev(thread.id, 'dev');

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

describe('Orchestrator desktop run-script adoption', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-run-adopt-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThread() {
    const worktreePath = join(dataDir, 'wt');
    const repoPath = join(dataDir, 'repo');
    mkdirSync(join(worktreePath, '.sideboard'), { recursive: true });
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      join(worktreePath, '.sideboard', 'settings.toml'),
      `[scripts.run.dev]\ncommand = "sleep 30"\ndefault = true\n`,
    );
    const thread = createEmptyThread({
      title: 'Adopt run',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/adopt-run',
      worktreePath,
      repoPath,
      agent: 'claude',
      status: 'idle',
    });
    writeThread(thread);
    return thread;
  }

  function asMcp(orch: Orchestrator): Orchestrator {
    (orch as unknown as { shouldOwnRunScripts: () => boolean }).shouldOwnRunScripts =
      () => false;
    orch.runScriptAdoptTimeoutMs = 2_000;
    return orch;
  }

  function asDesktop(orch: Orchestrator): Orchestrator {
    (orch as unknown as { shouldOwnRunScripts: () => boolean }).shouldOwnRunScripts =
      () => true;
    return orch;
  }

  async function waitForRequest(id: string) {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if (readThread(id)?.runScriptRequest?.op) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('runScriptRequest was not written');
  }

  it('does not spawn from MCP — persists runScriptRequest instead', async () => {
    const thread = seedThread();
    const conductor = await import('../hook/conductor.js');
    const spawn = vi.spyOn(conductor, 'startDevServer').mockResolvedValue({
      pid: 1,
      port: 41910,
      ports: [41910],
      scriptName: 'dev',
      kill: () => undefined,
      done: new Promise(() => undefined),
    });
    const mcp = asMcp(new Orchestrator());
    mcp.runScriptAdoptTimeoutMs = 120;

    await expect(mcp.startDev(thread.id, 'dev')).rejects.toThrow(/did not start/);
    expect(spawn).not.toHaveBeenCalled();
    expect(readThread(thread.id)?.runScriptRequest?.op).toBe('start');
    expect(readThread(thread.id)?.runScriptRequest?.scriptName).toBe('dev');
    expect(readThread(thread.id)?.devPort).toBeNull();
  });

  it('desktop adoptPersistedRunScripts spawns and unblocks MCP startDev', async () => {
    const thread = seedThread();
    const conductor = await import('../hook/conductor.js');
    vi.spyOn(conductor, 'startDevServer').mockResolvedValue({
      pid: 3,
      port: 41901,
      ports: [41901],
      scriptName: 'dev',
      kill: () => undefined,
      done: new Promise(() => undefined),
    });
    const mcp = asMcp(new Orchestrator());
    const desktop = asDesktop(new Orchestrator());

    const started = mcp.startDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    desktop.adoptPersistedRunScripts();
    const result = await started;
    expect(result.port).toBe(41901);
    expect(readThread(thread.id)?.devPort).toBe(41901);
    expect(readThread(thread.id)?.activeRuns?.[0]?.scriptName).toBe('dev');
    await desktop.stopDev(thread.id, 'dev');
  });

  it('desktop adopt surfaces startDev failures onto the MCP wait', async () => {
    const thread = seedThread();
    const conductor = await import('../hook/conductor.js');
    vi.spyOn(conductor, 'startDevServer').mockRejectedValue(new Error('spawn failed'));
    const mcp = asMcp(new Orchestrator());
    const desktop = asDesktop(new Orchestrator());

    const started = mcp.startDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    desktop.adoptPersistedRunScripts();
    await expect(started).rejects.toThrow('spawn failed');
    expect(readThread(thread.id)?.runScriptRequest?.error).toBe('spawn failed');
  });

  it('MCP stopDev waits until desktop clears activeRuns', async () => {
    const thread = seedThread();
    const live = readThread(thread.id)!;
    live.activeRuns = [
      {
        scriptName: 'dev',
        port: 41902,
        ports: [41902],
        startedAt: new Date().toISOString(),
      },
    ];
    live.devPort = 41902;
    writeThread(live);

    const conductor = await import('../hook/conductor.js');
    vi.spyOn(conductor, 'killListenersOnPorts').mockImplementation(() => undefined);

    const mcp = asMcp(new Orchestrator());
    const desktop = asDesktop(new Orchestrator());
    const stopped = mcp.stopDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    expect(readThread(thread.id)?.runScriptRequest?.op).toBe('stop');
    desktop.adoptPersistedRunScripts();
    await stopped;
    expect(readThread(thread.id)?.activeRuns).toEqual([]);
    expect(readThread(thread.id)?.devPort).toBeNull();
  });

  it('desktop re-adopts a claimed but unfulfilled runScriptRequest', async () => {
    const thread = seedThread();
    const live = readThread(thread.id)!;
    live.runScriptRequest = {
      op: 'start',
      scriptName: 'dev',
      requestId: 'req-claimed',
      requestedAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
    };
    writeThread(live);

    const conductor = await import('../hook/conductor.js');
    vi.spyOn(conductor, 'startDevServer').mockResolvedValue({
      pid: 9,
      port: 41903,
      ports: [41903],
      scriptName: 'dev',
      kill: () => undefined,
      done: new Promise(() => undefined),
    });
    const desktop = asDesktop(new Orchestrator());
    desktop.adoptPersistedRunScripts();
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && readThread(thread.id)?.devPort !== 41903) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(readThread(thread.id)?.devPort).toBe(41903);
    await desktop.stopDev(thread.id, 'dev');
  });

  it('MCP stopDev waits for desktop fulfill when no run is active yet', async () => {
    const thread = seedThread();
    const mcp = asMcp(new Orchestrator());
    mcp.runScriptAdoptTimeoutMs = 500;
    const stopped = mcp.stopDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    expect(readThread(thread.id)?.runScriptRequest?.op).toBe('stop');
    let done = false;
    void stopped.then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(done).toBe(false);

    const desktop = asDesktop(new Orchestrator());
    desktop.adoptPersistedRunScripts();
    await stopped;
    expect(readThread(thread.id)?.runScriptRequest?.fulfilledAt).toBeTruthy();
  });

  function replaceRequest(id: string, req: Partial<RunScriptRequest>) {
    const live = readThread(id)!;
    live.runScriptRequest = {
      op: 'start',
      scriptName: 'dev',
      requestId: 'req-replacement',
      requestedAt: new Date().toISOString(),
      ...req,
    };
    writeThread(live);
  }

  it('MCP stopDev fails fast when a newer start replaces its request', async () => {
    const thread = seedThread();
    const mcp = asMcp(new Orchestrator());
    mcp.runScriptAdoptTimeoutMs = 5_000;
    const began = Date.now();
    const stopped = mcp.stopDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    replaceRequest(thread.id, { op: 'start' });
    await expect(stopped).rejects.toThrow(/newer start request/);
    expect(Date.now() - began).toBeLessThan(1_000);
  });

  it('MCP stopDev follows a later stop for the same script', async () => {
    const thread = seedThread();
    const mcp = asMcp(new Orchestrator());
    mcp.runScriptAdoptTimeoutMs = 5_000;
    const stopped = mcp.stopDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    replaceRequest(thread.id, { op: 'stop' });
    await new Promise((r) => setTimeout(r, 80));
    replaceRequest(thread.id, { op: 'stop', fulfilledAt: new Date().toISOString() });
    await expect(stopped).resolves.toBeUndefined();
  });

  it('MCP stopDev follows a later stop-all that covers its script', async () => {
    const thread = seedThread();
    const mcp = asMcp(new Orchestrator());
    mcp.runScriptAdoptTimeoutMs = 5_000;
    const stopped = mcp.stopDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    replaceRequest(thread.id, { op: 'stop', scriptName: null });
    await new Promise((r) => setTimeout(r, 80));
    replaceRequest(thread.id, {
      op: 'stop',
      scriptName: null,
      fulfilledAt: new Date().toISOString(),
    });
    await expect(stopped).resolves.toBeUndefined();
  });

  it('MCP stopDev fails fast when a stop for another script replaces it', async () => {
    const thread = seedThread();
    const mcp = asMcp(new Orchestrator());
    mcp.runScriptAdoptTimeoutMs = 5_000;
    const began = Date.now();
    const stopped = mcp.stopDev(thread.id, 'dev');
    await waitForRequest(thread.id);
    replaceRequest(thread.id, { op: 'stop', scriptName: 'api' });
    await expect(stopped).rejects.toThrow(/replaced by another run-script request/);
    expect(Date.now() - began).toBeLessThan(1_000);
  });
});
