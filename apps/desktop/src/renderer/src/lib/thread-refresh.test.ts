import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyThreadToLists, createThreadRefreshScheduler } from './thread-refresh';
import type { Thread } from '@sideboard-ai/core';

function thread(partial: Partial<Thread> & { id: string; status: Thread['status'] }): Thread {
  return {
    title: partial.title ?? partial.id,
    sourceType: 'branch',
    sourceRef: '',
    branchName: 'thread/x',
    worktreePath: '/tmp/x',
    repoPath: '/tmp/repo',
    agent: 'claude',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    queue: [],
    ...partial,
  } as Thread;
}

describe('applyThreadToLists', () => {
  it('upserts an active thread and drops it from archived', () => {
    const a = thread({ id: 'a', status: 'idle' });
    const next = applyThreadToLists(
      { threads: [], archived: [thread({ id: 'a', status: 'archived' })] },
      { ...a, status: 'running' },
      'a',
    );
    expect(next.threads.map((t) => t.status)).toEqual(['running']);
    expect(next.archived).toEqual([]);
  });

  it('moves an archived thread out of the live list', () => {
    const a = thread({ id: 'a', status: 'idle' });
    const next = applyThreadToLists(
      { threads: [a], archived: [] },
      { ...a, status: 'archived' },
      'a',
    );
    expect(next.threads).toEqual([]);
    expect(next.archived.map((t) => t.id)).toEqual(['a']);
  });

  it('drops a deleted thread from both lists', () => {
    const a = thread({ id: 'a', status: 'idle' });
    const next = applyThreadToLists(
      { threads: [a], archived: [] },
      null,
      'a',
    );
    expect(next.threads).toEqual([]);
    expect(next.archived).toEqual([]);
  });
});

describe('createThreadRefreshScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces status patches and a full refresh into one full reload', () => {
    vi.useFakeTimers();
    const refreshAll = vi.fn();
    const refreshOne = vi.fn();
    const scheduler = createThreadRefreshScheduler({
      refreshAll,
      refreshOne,
      debounceMs: 300,
    });
    scheduler.schedule('status', 'a');
    scheduler.schedule('status', 'b');
    scheduler.schedule('full');
    vi.advanceTimersByTime(300);
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(refreshOne).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('flushes distinct status ids as one-thread patches', () => {
    vi.useFakeTimers();
    const refreshAll = vi.fn();
    const refreshOne = vi.fn();
    const scheduler = createThreadRefreshScheduler({
      refreshAll,
      refreshOne,
      debounceMs: 300,
    });
    scheduler.schedule('status', 'a');
    scheduler.schedule('status', 'a');
    scheduler.schedule('status', 'b');
    vi.advanceTimersByTime(300);
    expect(refreshAll).not.toHaveBeenCalled();
    expect(refreshOne).toHaveBeenCalledTimes(2);
    expect(refreshOne).toHaveBeenCalledWith('a');
    expect(refreshOne).toHaveBeenCalledWith('b');
    scheduler.dispose();
  });
});
