import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Thread } from '../types/thread.js';

const primary: Thread = {
  id: 'primary',
  title: 'Monaco',
  userSetTitle: false,
  sourceType: 'branch',
  sourceRef: 'main',
  branchName: 'thread/monaco',
  worktreePath: '/Users/me/sideboard/workspaces/sideboard/monaco',
  repoPath: '/Users/me/Projects/sideboard',
  agent: 'claude',
  model: null,
  effort: 'high',
  fast: false,
  planMode: false,
  sessionId: null,
  autonomy: 'default',
  sourceIsFork: false,
  status: 'idle',
  queue: [],
  parentThreadId: null,
  devPort: null,
  prUrl: null,
  prTitle: null,
  createdAt: '2026-08-01T23:10:10.000Z',
  updatedAt: '2026-08-01T23:10:10.000Z',
  messages: [],
  attachments: [],
};

const forked: Thread = {
  ...primary,
  id: 'forked',
  title: 'Arsenal',
  userSetTitle: true,
  createdAt: '2026-08-01T23:11:00.000Z',
  updatedAt: '2026-08-01T23:11:00.000Z',
};

const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
let listed: Thread[] = [primary, forked];

vi.mock('../git/run.js', () => ({
  git: async () => ({ stdout: 'thread/monaco\n', exitCode: 0 }),
}));

vi.mock('../store/thread-store.js', () => ({
  readThread: (id: string) => listed.find((t) => t.id === id) ?? null,
  updateThread: (id: string, patch: Record<string, unknown>) => {
    updates.push({ id, patch });
    listed = listed.map((t) => (t.id === id ? { ...t, ...patch } : t));
    return listed.find((t) => t.id === id)!;
  },
  listThreads: () => listed,
  findThreadByRef: (ref: string) => listed.find((t) => t.id === ref) ?? null,
}));

describe('syncThreadBranchFromGit', () => {
  beforeEach(() => {
    updates.length = 0;
    listed = [
      { ...primary, title: 'Monaco', userSetTitle: false },
      { ...forked, title: 'Arsenal', userSetTitle: true },
    ];
  });

  it('does not rewrite forked chat-tab titles to the worktree nickname', async () => {
    const { syncThreadBranchFromGit } = await import('./sync-branch.js');
    await syncThreadBranchFromGit('forked');

    expect(updates.some((u) => u.id === 'forked' && u.patch.title)).toBe(false);
    expect(listed.find((t) => t.id === 'forked')?.title).toBe('Arsenal');
  });

  it('still refreshes the canonical tab title when not user-set', async () => {
    listed = [
      { ...primary, title: 'Stale', userSetTitle: false },
      { ...forked, title: 'Arsenal', userSetTitle: true },
    ];
    const { syncThreadBranchFromGit } = await import('./sync-branch.js');
    await syncThreadBranchFromGit('primary');

    const primaryUpdate = updates.find((u) => u.id === 'primary' && u.patch.title);
    expect(primaryUpdate?.patch.title).toBe('Monaco');
    expect(listed.find((t) => t.id === 'forked')?.title).toBe('Arsenal');
  });
});
