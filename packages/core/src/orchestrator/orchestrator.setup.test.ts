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

import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.runSetup lastError', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-setup-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    runWorkspaceSetup.mockReset();
    runWorkspaceSetup.mockResolvedValue({
      ran: true,
      exitCode: 1,
      source: 'script/setup',
    });
  });

  afterEach(() => {
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
});
