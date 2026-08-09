import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Thread } from '../types/thread.js';

const source: Thread = {
  id: 'source-thread-id',
  title: 'West Ham',
  sourceType: 'branch',
  sourceRef: 'main',
  branchName: 'thread/west-ham',
  worktreePath: '/Users/me/sideboard/workspaces/sideboard/west-ham',
  repoPath: '/Users/me/Projects/sideboard',
  agent: 'claude',
  model: null,
  effort: 'high',
  fast: false,
  planMode: false,
  sessionId: 'sess-1',
  autonomy: 'default',
  sourceIsFork: false,
  status: 'idle',
  queue: [],
  parentThreadId: null,
  devPort: null,
  prUrl: null,
  createdAt: '2026-08-01T23:10:10.000Z',
  updatedAt: '2026-08-01T23:10:10.000Z',
  messages: [
    { role: 'user', text: 'hello', ts: '2026-08-01T23:10:11.000Z' },
    { role: 'agent', text: 'hi', ts: '2026-08-01T23:10:12.000Z' },
  ],
  attachments: [],
};

const newWorktreeThread: Thread = {
  ...source,
  id: 'forked-thread-id',
  title: 'Arsenal',
  branchName: 'thread/arsenal',
  worktreePath: '/Users/me/sideboard/workspaces/sideboard/arsenal',
  parentThreadId: source.id,
  messages: [],
  attachments: [],
  sessionId: null,
};

vi.mock('../store/thread-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/thread-store.js')>();
  return {
    ...actual,
    findThreadByRef: (ref: string) => (ref === source.id ? source : null),
  };
});

vi.mock('./create.js', () => ({
  createThread: vi.fn(async (input: { attachments?: Thread['attachments'] }) => ({
    ...newWorktreeThread,
    attachments: input.attachments ?? [],
  })),
}));

describe('forkThreadWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new git worktree from the source branch and seeds a transcript', async () => {
    const { forkThreadWorktree } = await import('./fork-worktree.js');
    const { createThread } = await import('./create.js');

    const forked = await forkThreadWorktree({ threadId: source.id, throughIndex: 1 });

    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'branch',
        sourceRef: 'thread/west-ham',
        repoPath: source.repoPath,
        agent: source.agent,
        model: source.model,
        fast: source.fast,
        planMode: source.planMode,
        parentThreadId: source.id,
        attachments: [
          expect.objectContaining({ kind: 'transcript' }),
        ],
      }),
      undefined,
    );
    expect(forked.worktreePath).not.toBe(source.worktreePath);
    expect(forked.branchName).not.toBe(source.branchName);
    expect(forked.worktreePath).toBe(newWorktreeThread.worktreePath);
    expect(forked.branchName).toBe(newWorktreeThread.branchName);
  });

  it('rejects orchestrator threads', async () => {
    const orchSource: Thread = {
      ...source,
      id: 'orch-id',
      sourceType: 'orchestration',
      repoPath: '__global__',
    };
    vi.doMock('../store/thread-store.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../store/thread-store.js')>();
      return {
        ...actual,
        findThreadByRef: (ref: string) => (ref === orchSource.id ? orchSource : null),
      };
    });
    vi.resetModules();
    const { forkThreadWorktree } = await import('./fork-worktree.js');
    await expect(forkThreadWorktree({ threadId: orchSource.id })).rejects.toThrow(
      /worktree agent thread/,
    );
  });
});

describe('forkChatTab vs forkThreadWorktree', () => {
  it('forkChatTab keeps the same worktree binding', async () => {
    vi.resetModules();
    let written: Thread | null = null;

    vi.doMock('../store/thread-store.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../store/thread-store.js')>();
      return {
        ...actual,
        findThreadByRef: (ref: string) => (ref === source.id ? source : null),
        listThreads: () => [source],
        writeThread: (thread: Thread) => {
          written = thread;
        },
      };
    });

    const { forkChatTab } = await import('./chat-tabs.js');
    const tab = forkChatTab({ threadId: source.id, throughIndex: 1 });

    expect(tab.worktreePath).toBe(source.worktreePath);
    expect(tab.branchName).toBe(source.branchName);
    expect(written?.worktreePath).toBe(source.worktreePath);
  });
});
