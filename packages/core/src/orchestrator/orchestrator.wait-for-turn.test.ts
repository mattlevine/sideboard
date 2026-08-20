import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.waitForTurn still running', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-wait-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('resolves with the live thread when resolveIfStillRunning is set', async () => {
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
    const thread = createEmptyThread({
      title: 'Review',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/review',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      status: 'running',
    });
    writeThread(thread);
    const orch = new Orchestrator();
    const result = await orch.waitForTurn(thread.id, 50, {
      resolveIfStillRunning: true,
    });
    expect(result.status).toBe('running');
  });
});
