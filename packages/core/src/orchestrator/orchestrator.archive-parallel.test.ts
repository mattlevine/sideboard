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
    removeWorktree.mockReset();
    removeWorktree.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
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

  it('archives project chats before removeWorkspace resolves', async () => {
    let release: (() => void) | undefined;
    removeWorktree.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const repo = join(dataDir, 'repo');
    const thread = seed({ title: 'gone', worktreePath: join(dataDir, 'wt') });
    const orch = new Orchestrator();
    let settled = false;
    const pending = orch.removeWorkspace(repo).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(removeWorktree).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(readThread(thread.id)?.status).not.toBe('archived');
    release?.();
    await pending;
    expect(readThread(thread.id)?.status).toBe('archived');
  });

  it('surfaces an archive failure and still archives the other chat', async () => {
    const repo = join(dataDir, 'repo');
    const bad = seed({ title: 'bad', worktreePath: join(dataDir, 'wt-bad') });
    const ok = seed({ title: 'ok', worktreePath: join(dataDir, 'wt-ok') });
    removeWorktree.mockImplementation(async (_repo: string, worktreePath: string) => {
      if (worktreePath.endsWith('wt-bad')) throw new Error('worktree busy');
    });
    const orch = new Orchestrator();
    await expect(orch.removeWorkspace(repo)).rejects.toThrow('worktree busy');
    expect(readThread(bad.id)?.status).not.toBe('archived');
    expect(readThread(ok.id)?.status).toBe('archived');
  });
});
