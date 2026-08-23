import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverFinishedCursorRun } from './cursor-recover.js';

describe('recoverFinishedCursorRun', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-cursor-recover-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    mkdirSync(join(dataDir, 'cursor-sdk-store'), { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('recovers the latest finished run for an agent', () => {
    const runsPath = join(dataDir, 'cursor-sdk-store', 'runs.ndjson');
    writeFileSync(
      runsPath,
      [
        JSON.stringify({
          runId: 'run-old',
          agentId: 'agent-1',
          status: 'finished',
          result: 'old',
          createdAt: 1000,
          endedAt: 2000,
        }),
        JSON.stringify({
          runId: 'run-new',
          agentId: 'agent-1',
          status: 'finished',
          result: 'fresh answer',
          createdAt: 5000,
          endedAt: 6000,
        }),
        JSON.stringify({
          runId: 'run-other',
          agentId: 'agent-2',
          status: 'finished',
          result: 'nope',
          createdAt: 7000,
          endedAt: 8000,
        }),
      ].join('\n'),
    );

    const hit = recoverFinishedCursorRun({
      agentId: 'agent-1',
      startedAfterMs: 4000,
    });
    expect(hit?.runId).toBe('run-new');
    expect(hit?.result).toBe('fresh answer');
  });

  it('ignores unfinished runs', () => {
    const runsPath = join(dataDir, 'cursor-sdk-store', 'runs.ndjson');
    writeFileSync(
      runsPath,
      JSON.stringify({
        runId: 'run-running',
        agentId: 'agent-1',
        status: 'running',
        result: null,
        createdAt: 5000,
        endedAt: null,
      }),
    );
    expect(
      recoverFinishedCursorRun({ agentId: 'agent-1', startedAfterMs: 0 }),
    ).toBeNull();
  });

  it('recovers a finished run from the thread-scoped catalog', () => {
    const scopedDir = join(dataDir, 'cursor-sdk-store', 'threads', 'thread-1');
    mkdirSync(scopedDir, { recursive: true });
    writeFileSync(
      join(scopedDir, 'runs.ndjson'),
      JSON.stringify({
        runId: 'run-scoped',
        agentId: 'agent-1',
        status: 'finished',
        result: 'from thread store',
        createdAt: 5000,
        endedAt: 6000,
      }),
    );
    const hit = recoverFinishedCursorRun({
      agentId: 'agent-1',
      startedAfterMs: 0,
      threadId: 'thread-1',
    });
    expect(hit?.runId).toBe('run-scoped');
    expect(hit?.result).toBe('from thread store');
  });
});
