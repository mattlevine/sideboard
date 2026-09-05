import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';

const runWorkspaceSetup = vi.hoisted(() => vi.fn());

vi.mock('../hook/conductor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hook/conductor.js')>();
  return {
    ...actual,
    runWorkspaceSetup,
  };
});

import { resetSetupLogMemory } from '../store/setup-log.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.runSetup lastError', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-setup-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetSetupLogMemory();
    runWorkspaceSetup.mockReset();
    runWorkspaceSetup.mockResolvedValue({
      ran: true,
      exitCode: 1,
      source: 'script/setup',
    });
  });

  afterEach(() => {
    resetSetupLogMemory();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seedThread(status: 'idle' | 'running' = 'idle') {
    const worktreePath = join(dataDir, 'wt');
    mkdirSync(worktreePath, { recursive: true });
    const thread = createEmptyThread({
      title: 'Setup',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/setup',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      status,
    });
    writeThread(thread);
    return thread;
  }

  it('records lastError when setup fails on an idle thread', async () => {
    const thread = seedThread('idle');
    const orch = new Orchestrator();
    await orch.runSetup(thread.id);
    expect(readThread(thread.id)?.lastError).toBe('Setup exited 1');
  });

  it('does not stamp lastError when a Claude turn is already in tool_use', async () => {
    const thread = seedThread('running');
    const orch = new Orchestrator();
    const internal = orch as unknown as {
      activeTurns: Map<string, unknown>;
    };
    internal.activeTurns.set(thread.id, { pid: 1, kill: () => undefined, done: Promise.resolve() });
    await orch.runSetup(thread.id);
    expect(readThread(thread.id)?.lastError).toBeNull();
  });

  it('does not stamp lastError when status is running even without an active handle', async () => {
    const thread = seedThread('running');
    const orch = new Orchestrator();
    await orch.runSetup(thread.id);
    expect(readThread(thread.id)?.lastError).toBeNull();
  });

  it('emits setup_finished and keeps a replayable log when no script exists', async () => {
    runWorkspaceSetup.mockResolvedValue({
      ran: false,
      exitCode: null,
      source: null,
    });
    const thread = seedThread('idle');
    const orch = new Orchestrator();
    const events: string[] = [];
    const off = orch.on((event) => {
      if (event.type === 'setup_started' || event.type === 'setup_finished') {
        events.push(event.type);
      }
    });
    await expect(orch.runSetup(thread.id)).rejects.toThrow(/no setup script/i);
    off();
    expect(events).toEqual(['setup_started', 'setup_finished']);
    const log = orch.getSetupLog(thread.id);
    expect(log.running).toBe(false);
    expect(log.output).toMatch(/no setup script/i);
  });

  it('replays setup output after the process ends', async () => {
    runWorkspaceSetup.mockImplementation(async (_repo, _wt, onLine: (line: string) => void) => {
      onLine('[setup] .sideboard/settings.toml (worktree)');
      onLine('ok');
      return { ran: true, exitCode: 0, source: '.sideboard/settings.toml (worktree)' };
    });
    const thread = seedThread('idle');
    const orch = new Orchestrator();
    await orch.runSetup(thread.id);
    const log = orch.getSetupLog(thread.id);
    expect(log.running).toBe(false);
    expect(log.exitCode).toBe(0);
    expect(log.output).toContain('[setup] .sideboard/settings.toml (worktree)');
    expect(log.output).toContain('ok');
  });
});
