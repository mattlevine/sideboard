import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadFilePath } from '../store/paths.js';
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

  it('returns immediately when leftover running status is not actually live', async () => {
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
    const path = threadFilePath(thread.id);
    const next = {
      ...JSON.parse(readFileSync(path, 'utf8')),
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
    writeFileSync(path, JSON.stringify(next, null, 2));
    utimesSync(path, new Date('2020-01-01'), new Date('2020-01-01'));
    const started = Date.now();
    const result = await new Orchestrator().waitForTurn(thread.id, 5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.status).toBe('stopped');
  });
});
