import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.worktreeDirtyStat', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-dirty-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns a clean stat for the global coordinator', async () => {
    const thread = createEmptyThread({
      title: 'San Lorenzo',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'cursor',
    });
    writeThread(thread);

    const stat = await new Orchestrator().worktreeDirtyStat(thread.id);

    expect(stat).toEqual({ additions: 0, deletions: 0, dirty: false });
  });
});
