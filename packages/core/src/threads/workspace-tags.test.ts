import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeWorkspaceTags } from '../git/worktree-labels.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import { applyWorkspaceTags, workspaceTagTargetRef } from './workspace-tags.js';

describe('workspace tags', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-workspace-tags-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('normalizes, dedupes, and caps tags', () => {
    expect(normalizeWorkspaceTags(' phone-sync, Auth, phone-sync ')).toEqual([
      'phone-sync',
      'Auth',
    ]);
    expect(normalizeWorkspaceTags(['  a  ', '', 3, 'a'])).toEqual(['a']);
    expect(normalizeWorkspaceTags(null)).toEqual([]);
    expect(normalizeWorkspaceTags('x'.repeat(40))[0]).toHaveLength(32);
  });

  it('writes the same tags onto every chat in the workspace', () => {
    const worktreePath = join(dataDir, 'marseille');
    const first = createEmptyThread({
      title: 'Marseille',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/marseille',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'claude',
    });
    const second = createEmptyThread({
      title: 'Ajax',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/marseille',
      worktreePath,
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
    });
    writeThread(first);
    writeThread(second);

    const updated = applyWorkspaceTags(first.id, ['phone-sync', 'phone-sync'], 'replace');
    expect(updated.tags).toEqual(['phone-sync']);
    expect(readThread(second.id)?.tags).toEqual(['phone-sync']);

    applyWorkspaceTags(second.id, 'auth', 'add');
    expect(readThread(first.id)?.tags).toEqual(['phone-sync', 'auth']);
    applyWorkspaceTags(first.id, ['phone-sync'], 'remove');
    expect(readThread(second.id)?.tags).toEqual(['auth']);
  });

  it('lets a worktree agent retag only its own checkout', () => {
    const caller = {
      id: 'chat-a',
      worktreePath: '/wt/marseille',
      sourceType: 'branch' as const,
      repoPath: '/repo',
    };
    const sibling = { ...caller, id: 'chat-b' };
    const other = { ...caller, id: 'chat-c', worktreePath: '/wt/ajax' };
    const find = (ref: string) => [caller, sibling, other].find((row) => row.id === ref) ?? null;
    expect(workspaceTagTargetRef({ ownWorktreeOnly: true, caller, find })).toBe('chat-a');
    expect(
      workspaceTagTargetRef({ ownWorktreeOnly: true, caller, requestedRef: 'chat-b', find }),
    ).toBe('chat-b');
    expect(() =>
      workspaceTagTargetRef({ ownWorktreeOnly: true, caller, requestedRef: 'chat-c', find }),
    ).toThrow(/this workspace/);
    expect(() =>
      workspaceTagTargetRef({
        ownWorktreeOnly: true,
        caller: { ...caller, sourceType: 'orchestration', repoPath: '__global__' },
        find,
      }),
    ).toThrow(/project workspace/);
    expect(
      workspaceTagTargetRef({
        ownWorktreeOnly: false,
        caller: null,
        requestedRef: 'chat-c',
        find,
      }),
    ).toBe('chat-c');
  });

  it('refuses to tag an orchestration chat', () => {
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
    expect(() => applyWorkspaceTags(orch.id, ['phone-sync'])).toThrow(/project workspace/);
  });
});
