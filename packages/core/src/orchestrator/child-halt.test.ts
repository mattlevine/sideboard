import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import {
  childHaltNotice,
  isIncompleteChildStatus,
  notifyParentOfChildHalt,
  resetChildHaltNotifications,
  shouldNotifyParentOfChildHalt,
} from './child-halt.js';

describe('child halt notice', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-child-halt-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetChildHaltNotifications();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('treats stopped/error/broken as incomplete', () => {
    expect(isIncompleteChildStatus('stopped')).toBe(true);
    expect(isIncompleteChildStatus('error')).toBe(true);
    expect(isIncompleteChildStatus('broken')).toBe(true);
    expect(isIncompleteChildStatus('idle')).toBe(false);
    expect(isIncompleteChildStatus('running')).toBe(false);
  });

  it('notifies an orchestration parent once per child status', async () => {
    const parent = createEmptyThread({
      title: 'San Carlos',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'claude',
    });
    writeThread(parent);
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
    const child = createEmptyThread({
      title: 'Fix panel',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/limon',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
      parentThreadId: parent.id,
    });
    child.lastError = 'Process died (agent exited)';
    writeThread(child);

    expect(
      shouldNotifyParentOfChildHalt({
        child,
        parent,
        status: 'stopped',
      }),
    ).toBe(true);

    const sends: Array<{ id: string; prompt: string }> = [];
    const send = async (id: string, prompt: string) => {
      sends.push({ id, prompt });
    };
    expect(notifyParentOfChildHalt(child, 'stopped', send)).toBe(true);
    expect(notifyParentOfChildHalt(child, 'stopped', send)).toBe(false);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.id).toBe(parent.id);
    expect(sends[0]!.prompt).toContain('sideboard://thread/');
    expect(sends[0]!.prompt).toContain('stopped before finishing');
    expect(sends[0]!.prompt).toContain('Process died');
  });

  it('skips worktree parents and missing parentThreadId', () => {
    const worktreeParent = createEmptyThread({
      title: 'Not orch',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/x',
      worktreePath: join(dataDir, 'p'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    const child = createEmptyThread({
      title: 'Kid',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/y',
      worktreePath: join(dataDir, 'c'),
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
      parentThreadId: worktreeParent.id,
    });
    expect(
      shouldNotifyParentOfChildHalt({
        child,
        parent: worktreeParent,
        status: 'stopped',
      }),
    ).toBe(false);
    expect(
      shouldNotifyParentOfChildHalt({
        child: { ...child, parentThreadId: null },
        parent: worktreeParent,
        status: 'stopped',
      }),
    ).toBe(false);
  });

  it('formats a resume hint', () => {
    const child = createEmptyThread({
      title: 'Fix panel',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/limon',
      worktreePath: join(dataDir, 'wt'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
    });
    expect(childHaltNotice(child, 'stopped')).toMatch(/send_to_thread/);
  });
});
