import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const removeWorktree = vi.hoisted(() =>
  vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }),
);

vi.mock('../git/worktree.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../git/worktree.js')>();
  return { ...orig, removeWorktree };
});

import {
  createEmptyThread,
  readThread,
  writeThread,
} from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

describe('Orchestrator.archive parallel', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-archive-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    removeWorktree.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(opts: { title: string; worktreePath: string }) {
    const thread = createEmptyThread({
      title: opts.title,
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: `thread/${opts.title}`,
      worktreePath: opts.worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    writeThread(thread);
    return thread;
  }

  it('tears down once when sibling tabs archive at the same time', async () => {
    const path = join(dataDir, 'wt-shared');
    const a = seed({ title: 'alpha', worktreePath: path });
    const b = seed({ title: 'beta', worktreePath: path });
    const orch = new Orchestrator();
    await Promise.all([orch.archive(a.id), orch.archive(b.id)]);
    expect(readThread(a.id)?.status).toBe('archived');
    expect(readThread(b.id)?.status).toBe('archived');
    expect(removeWorktree).toHaveBeenCalledTimes(1);
    expect(removeWorktree).toHaveBeenCalledWith(join(dataDir, 'repo'), path);
  });

  it('tears down each worktree when two archives overlap', async () => {
    const a = seed({ title: 'one', worktreePath: join(dataDir, 'wt-one') });
    const b = seed({ title: 'two', worktreePath: join(dataDir, 'wt-two') });
    const orch = new Orchestrator();
    await Promise.all([orch.archive(a.id), orch.archive(b.id)]);
    expect(removeWorktree).toHaveBeenCalledTimes(2);
  });
});
