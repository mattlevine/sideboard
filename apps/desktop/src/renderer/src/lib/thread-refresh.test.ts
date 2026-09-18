import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyThreadToLists,
  createThreadRefreshScheduler,
  isFresherFullThread,
  mergeFullThreadIntoLists,
  threadListsUnchanged,
  vanishedLiveThreadIds,
} from './thread-refresh';
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

describe('vanishedLiveThreadIds', () => {
  it('lists live ids missing from a live-only refresh (archived elsewhere)', () => {
    const a = thread({ id: 'a', status: 'idle' });
    const b = thread({ id: 'b', status: 'running' });
    const c = thread({ id: 'c', status: 'idle' });
    expect(vanishedLiveThreadIds([a, b, c], [a, c])).toEqual(['b']);
    expect(vanishedLiveThreadIds([a], [a, b])).toEqual([]);
    expect(vanishedLiveThreadIds([], [a])).toEqual([]);
  });
});

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

describe('mergeFullThreadIntoLists', () => {
  it('replaces the slim list row with the full transcript', () => {
    const slim = thread({ id: 'a', status: 'idle', messages: [{ role: 'user', text: 'hi', ts: 't' }] });
    const full = thread({
      id: 'a',
      status: 'idle',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [
        { role: 'user', text: 'hi', ts: 't' },
        { role: 'agent', text: 'long answer', ts: 't2' },
      ],
    });
    const next = mergeFullThreadIntoLists({ threads: [slim], archived: [] }, full);
    expect(next.threads[0]?.messages).toHaveLength(2);
    expect(next.threads[0]?.messages[1]?.text).toBe('long answer');
  });
});

describe('isFresherFullThread', () => {
  it('rejects an older updatedAt snapshot', () => {
    const newer = thread({
      id: 'a',
      status: 'idle',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [{ role: 'user', text: 'hi', ts: 't' }],
    });
    const older = thread({
      id: 'a',
      status: 'idle',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [],
    });
    expect(isFresherFullThread(newer, older)).toBe(false);
    expect(isFresherFullThread(older, newer)).toBe(true);
    expect(isFresherFullThread(undefined, older)).toBe(true);
  });

  it('at the same clock prefers the longer transcript', () => {
    const short = thread({
      id: 'a',
      status: 'idle',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [{ role: 'user', text: 'hi', ts: 't' }],
    });
    const long = thread({
      id: 'a',
      status: 'idle',
      updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [
        { role: 'user', text: 'hi', ts: 't' },
        { role: 'agent', text: 'ok', ts: 't2' },
      ],
    });
    expect(isFresherFullThread(long, short)).toBe(false);
    expect(isFresherFullThread(short, long)).toBe(true);
  });
});

describe('threadListsUnchanged', () => {
  it('treats identical id/updatedAt/status/length as unchanged', () => {
    const a = thread({ id: 'a', status: 'idle' });
    expect(threadListsUnchanged({ threads: [a], archived: [] }, { threads: [a], archived: [] })).toBe(
      true,
    );
    expect(
      threadListsUnchanged(
        { threads: [a], archived: [] },
        { threads: [{ ...a, status: 'running' }], archived: [] },
      ),
    ).toBe(false);
  });
});
