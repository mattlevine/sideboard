import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Thread } from '@sideboard-ai/core';
import {
  dropPlaceFromMidpoint,
  orderWorktreeChats,
  orderWorktreeChatsForKey,
  pickWorktreeChat,
  readWorktreeTabPrefs,
  reorderChatIds,
  writeLastWorktreeChatId,
  writeWorktreeChatOrder,
} from './worktree-tabs';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
  });
}

function thread(
  partial: Partial<Thread> & Pick<Thread, 'id' | 'worktreePath' | 'createdAt'>,
): Thread {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    sourceType: partial.sourceType ?? 'branch',
    sourceRef: partial.sourceRef ?? 'main',
    branchName: partial.branchName ?? 'feature',
    worktreePath: partial.worktreePath,
    repoPath: partial.repoPath ?? '/repo',
    agent: partial.agent ?? 'claude',
    model: partial.model ?? null,
    effort: partial.effort ?? 'high',
    fast: partial.fast ?? false,
    planMode: partial.planMode ?? false,
    sessionId: partial.sessionId ?? null,
    autonomy: partial.autonomy ?? 'default',
    sourceIsFork: partial.sourceIsFork ?? false,
    status: partial.status ?? 'idle',
    queue: partial.queue ?? [],
    parentThreadId: partial.parentThreadId ?? null,
    devPort: partial.devPort ?? null,
    prUrl: partial.prUrl ?? null,
    prTitle: partial.prTitle ?? null,
    prState: partial.prState ?? null,
    stackId: partial.stackId ?? null,
    stackLayer: partial.stackLayer ?? null,
    userSetTitle: partial.userSetTitle ?? false,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    messages: partial.messages ?? [],
    attachments: partial.attachments ?? [],
  };
}

describe('worktree-tabs', () => {
  beforeEach(() => {
    installLocalStorage();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('remembers last chat per worktree without cross-bleed', () => {
    writeLastWorktreeChatId('/wt/monaco/', 'chat-b');
    expect(readWorktreeTabPrefs('/wt/monaco').lastChatId).toBe('chat-b');
    expect(readWorktreeTabPrefs('/wt/cruzeiro').lastChatId).toBeUndefined();
    writeLastWorktreeChatId('/wt/cruzeiro', 'chat-z');
    expect(readWorktreeTabPrefs('/wt/monaco').lastChatId).toBe('chat-b');
    expect(readWorktreeTabPrefs('/wt/cruzeiro/').lastChatId).toBe('chat-z');
  });

  it('merges chat order with last chat id', () => {
    writeLastWorktreeChatId('/wt/monaco', 'chat-b');
    writeWorktreeChatOrder('/wt/monaco', ['chat-b', 'chat-a']);
    expect(readWorktreeTabPrefs('/wt/monaco')).toEqual({
      lastChatId: 'chat-b',
      chatOrder: ['chat-b', 'chat-a'],
    });
    writeLastWorktreeChatId('/wt/monaco', 'chat-a');
    expect(readWorktreeTabPrefs('/wt/monaco')).toEqual({
      lastChatId: 'chat-a',
      chatOrder: ['chat-b', 'chat-a'],
    });
  });

  it('orders chats by saved ids and appends new ones by createdAt', () => {
    const a = { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' };
    const c = { id: 'c', createdAt: '2026-01-03T00:00:00.000Z' };
    expect(orderWorktreeChats([c, a, b], null).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(orderWorktreeChats([c, a, b], ['b', 'a']).map((t) => t.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    writeWorktreeChatOrder('/wt/monaco', ['c', 'a']);
    expect(orderWorktreeChatsForKey([b, a, c], '/wt/monaco/').map((t) => t.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('picks current selection, then last tab, then oldest', () => {
    const group = [
      thread({
        id: 'old',
        worktreePath: '/wt/monaco',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      thread({
        id: 'new',
        worktreePath: '/wt/monaco',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    ];
    expect(pickWorktreeChat(group, 'new')?.id).toBe('new');
    expect(pickWorktreeChat(group, 'other')?.id).toBe('old');
    writeLastWorktreeChatId('/wt/monaco', 'new');
    expect(pickWorktreeChat(group, null)?.id).toBe('new');
    expect(pickWorktreeChat(group, 'missing')?.id).toBe('new');
    writeLastWorktreeChatId('/wt/monaco', 'gone');
    expect(pickWorktreeChat(group, null)?.id).toBe('old');
  });

  it('uses an explicit tab key for last-open orchestration chats', () => {
    const group = [
      thread({
        id: 'orch-a',
        worktreePath: '/tmp/sideboard-global',
        repoPath: '__global__',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      thread({
        id: 'orch-b',
        worktreePath: '/tmp/sideboard-global',
        repoPath: '__global__',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    ];
    writeLastWorktreeChatId('__global__', 'orch-b');
    expect(pickWorktreeChat(group, null, '__global__')?.id).toBe('orch-b');
    expect(pickWorktreeChat(group, 'orch-a', '__global__')?.id).toBe('orch-a');
  });

  it('falls back to the cwd last-chat key when __global__ is empty', () => {
    const group = [
      thread({
        id: 'orch-a',
        worktreePath: '/tmp/sideboard-global',
        repoPath: '__global__',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      thread({
        id: 'orch-b',
        worktreePath: '/tmp/sideboard-global',
        repoPath: '__global__',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    ];
    writeLastWorktreeChatId('/tmp/sideboard-global', 'orch-b');
    expect(pickWorktreeChat(group, null, '__global__')?.id).toBe('orch-b');
  });

  it('reorders ids before or after a target', () => {
    expect(reorderChatIds(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(reorderChatIds(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(reorderChatIds(['a', 'b', 'c'], 'a', 'a', 'before')).toEqual(['a', 'b', 'c']);
    expect(reorderChatIds(['a', 'b', 'c'], 'x', 'b', 'before')).toEqual(['a', 'b', 'c']);
  });

  it('picks before/after from the pointer’s side of the midpoint', () => {
    expect(dropPlaceFromMidpoint(0, 40)).toBe('before');
    expect(dropPlaceFromMidpoint(19, 40)).toBe('before');
    expect(dropPlaceFromMidpoint(20, 40)).toBe('after');
    expect(dropPlaceFromMidpoint(8, 0)).toBe('after');
  });

  it('persists a nested-agent reorder for the worktree key', () => {
    const a = { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' };
    const c = { id: 'c', createdAt: '2026-01-03T00:00:00.000Z' };
    const next = reorderChatIds(['a', 'b', 'c'], 'c', 'a', 'before');
    writeWorktreeChatOrder('/wt/monaco', next);
    expect(orderWorktreeChatsForKey([b, a, c], '/wt/monaco').map((t) => t.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('persists orchestration agent order on the global workspace key', () => {
    const a = { id: 'orch-a', createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'orch-b', createdAt: '2026-01-02T00:00:00.000Z' };
    const c = { id: 'orch-c', createdAt: '2026-01-03T00:00:00.000Z' };
    writeWorktreeChatOrder('__global__', ['orch-c', 'orch-a', 'orch-b']);
    expect(
      orderWorktreeChatsForKey([b, a, c], '__global__').map((t) => t.id),
    ).toEqual(['orch-c', 'orch-a', 'orch-b']);
  });
});
