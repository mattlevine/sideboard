import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import { Orchestrator } from './orchestrator.js';

const removeWorktree = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../git/worktree.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../git/worktree.js')>();
  return { ...orig, removeWorktree };
});

describe('Orchestrator workspace archive', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-archive-ws-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    removeWorktree.mockReset();
    removeWorktree.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(opts: {
    title: string;
    worktreePath: string;
    repoPath?: string;
    sourceType?: 'branch' | 'orchestration';
  }) {
    const thread = createEmptyThread({
      title: opts.title,
      sourceType: opts.sourceType ?? 'branch',
      sourceRef: opts.title,
      branchName: `thread/${opts.title}`,
      worktreePath: opts.worktreePath,
      repoPath: opts.repoPath ?? join(dataDir, 'repo'),
      agent: 'claude',
    });
    writeThread(thread);
    return thread;
  }

  it('archives every agent and tears the worktree down once', async () => {
    const path = join(dataDir, 'wt-shared');
    const a = seed({ title: 'alpha', worktreePath: path });
    const b = seed({ title: 'beta', worktreePath: path });
    const other = seed({ title: 'other', worktreePath: join(dataDir, 'wt-other') });
    const orch = new Orchestrator();
    const archived = await orch.archiveWorkspace(a.id);
    expect(archived.map((thread) => thread.id).sort()).toEqual([a.id, b.id].sort());
    expect(readThread(a.id)?.status).toBe('archived');
    expect(readThread(b.id)?.status).toBe('archived');
    expect(readThread(other.id)?.status).not.toBe('archived');
    expect(removeWorktree).toHaveBeenCalledTimes(1);
    expect(removeWorktree).toHaveBeenCalledWith(join(dataDir, 'repo'), path);
  });

  it('restores every archived agent on the checkout', async () => {
    const path = join(dataDir, 'wt-shared');
    mkdirSync(path, { recursive: true });
    const a = seed({ title: 'alpha', worktreePath: path });
    const b = seed({ title: 'beta', worktreePath: path });
    const orch = new Orchestrator();
    await orch.archiveWorkspace(b.id);
    const restored = await orch.restoreWorkspace(a.id);
    expect(restored.map((thread) => thread.status)).toEqual(['idle', 'idle']);
    expect(readThread(a.id)?.status).toBe('idle');
    expect(readThread(b.id)?.status).toBe('idle');
  });

  it('restores only the archived agent when the checkout is still live', async () => {
    const path = join(dataDir, 'wt-shared');
    mkdirSync(path, { recursive: true });
    const live = seed({ title: 'live', worktreePath: path });
    const closed = seed({ title: 'closed', worktreePath: path });
    const orch = new Orchestrator();
    await orch.archive(closed.id);
    expect(removeWorktree).not.toHaveBeenCalled();
    const restored = await orch.restoreWorkspace(live.id);
    expect(restored.map((thread) => thread.id)).toEqual([closed.id]);
    expect(readThread(live.id)?.status).toBe('idle');
    expect(readThread(closed.id)?.status).toBe('idle');
  });

  it('refuses to treat an orchestration chat as a workspace', async () => {
    const thread = seed({
      title: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      sourceType: 'orchestration',
    });
    const orch = new Orchestrator();
    await expect(orch.archiveWorkspace(thread.id)).rejects.toThrow(/archive_chat/);
    await expect(orch.restoreWorkspace(thread.id)).rejects.toThrow(/restore_chat/);
    expect(readThread(thread.id)?.status).not.toBe('archived');
  });

  it('tells you when the workspace is already fully archived', async () => {
    const path = join(dataDir, 'wt');
    const thread = seed({ title: 'gone', worktreePath: path });
    const orch = new Orchestrator();
    await orch.archiveWorkspace(thread.id);
    await expect(orch.archiveWorkspace(thread.id)).rejects.toThrow(/already archived/);
  });
});
