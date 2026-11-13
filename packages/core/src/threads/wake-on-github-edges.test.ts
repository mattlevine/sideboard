import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateAdvancedSettings } from '../store/app-settings.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import { applyWakeOnGithubEdges, wakeOnGithubEdgesTargetRef } from './wake-on-github-edges.js';

describe('wake on github edges', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-wake-edges-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function checkout(title: string, worktreePath: string) {
    const thread = createEmptyThread({
      title,
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/wake',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
    });
    writeThread(thread);
    return thread;
  }

  it('refuses until the Advanced switch is on, then writes every chat on the checkout', () => {
    const worktreePath = join(dataDir, 'odense');
    const first = checkout('Odense', worktreePath);
    const second = checkout('Ajax', worktreePath);
    expect(() => applyWakeOnGithubEdges(first.id, true)).toThrow(/Settings → Advanced/);
    expect(readThread(first.id)?.wakeOnGithubEdges).toBeUndefined();

    updateAdvancedSettings({ wakeOrchestratorOnGithubEdges: true });
    const updated = applyWakeOnGithubEdges(first.id, true);
    expect(updated.wakeOnGithubEdges).toBe(true);
    expect(readThread(second.id)?.wakeOnGithubEdges).toBe(true);

    applyWakeOnGithubEdges(second.id, false);
    expect(readThread(first.id)?.wakeOnGithubEdges).toBeUndefined();
    expect(readThread(second.id)?.wakeOnGithubEdges).toBeUndefined();
  });

  it('refuses an orchestration chat even when the Advanced switch is on', () => {
    updateAdvancedSettings({ wakeOrchestratorOnGithubEdges: true });
    const orch = createEmptyThread({
      title: 'San Lorenzo',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'cursor',
    });
    writeThread(orch);
    expect(() => applyWakeOnGithubEdges(orch.id, true)).toThrow(/project workspace/);
  });

  it('lets a worktree agent change only its own checkout', () => {
    const caller = {
      id: 'chat-a',
      worktreePath: '/wt/odense',
      sourceType: 'branch' as const,
      repoPath: '/repo',
    };
    const sibling = { ...caller, id: 'chat-b' };
    const other = { ...caller, id: 'chat-c', worktreePath: '/wt/ajax' };
    const find = (ref: string) => [caller, sibling, other].find((row) => row.id === ref) ?? null;
    expect(wakeOnGithubEdgesTargetRef({ ownWorktreeOnly: true, caller, find })).toBe('chat-a');
    expect(
      wakeOnGithubEdgesTargetRef({ ownWorktreeOnly: true, caller, requestedRef: 'chat-b', find }),
    ).toBe('chat-b');
    expect(() =>
      wakeOnGithubEdgesTargetRef({ ownWorktreeOnly: true, caller, requestedRef: 'chat-c', find }),
    ).toThrow(/this workspace/);
    expect(() =>
      wakeOnGithubEdgesTargetRef({
        ownWorktreeOnly: true,
        caller: { ...caller, sourceType: 'orchestration', repoPath: GLOBAL_WORKSPACE_ID },
        find,
      }),
    ).toThrow(/project workspace/);
    expect(
      wakeOnGithubEdgesTargetRef({
        ownWorktreeOnly: false,
        caller: null,
        requestedRef: 'chat-c',
        find,
      }),
    ).toBe('chat-c');
    expect(() =>
      wakeOnGithubEdgesTargetRef({ ownWorktreeOnly: false, caller: null, find }),
    ).toThrow(/Pass a chat id/);
  });
});
