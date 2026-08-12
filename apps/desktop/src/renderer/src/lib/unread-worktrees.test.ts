import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Thread } from '@sideboard-ai/core';
import {
  baselineUnreadWorktrees,
  getWorktreeLastSeen,
  isWorktreeUnread,
  latestAgentResponseAt,
  markWorktreeSeen,
  unreadWorktreeKey,
} from './unread-worktrees';

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

function thread(partial: Partial<Thread> & Pick<Thread, 'id' | 'worktreePath'>): Thread {
  return {
    id: partial.id,
    title: partial.title ?? 't',
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
    createdAt: partial.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-08-01T00:00:00.000Z',
    messages: partial.messages ?? [],
    attachments: partial.attachments ?? [],
  };
}

describe('unread-worktrees', () => {
  beforeEach(() => {
    installLocalStorage();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('normalizes worktree keys', () => {
    expect(
      unreadWorktreeKey(
        thread({ id: '1', worktreePath: '/tmp/wt/', repoPath: '/repo' }),
      ),
    ).toBe('/tmp/wt');
  });

  it('finds the latest agent response timestamp', () => {
    const group = [
      thread({
        id: 'a',
        worktreePath: '/wt',
        messages: [
          { role: 'user', text: 'hi', ts: '2026-08-01T10:00:00.000Z' },
          { role: 'agent', text: 'yo', ts: '2026-08-01T10:01:00.000Z' },
        ],
      }),
      thread({
        id: 'b',
        worktreePath: '/wt',
        messages: [{ role: 'agent', text: 'later', ts: '2026-08-01T11:00:00.000Z' }],
      }),
    ];
    expect(latestAgentResponseAt(group)).toBe('2026-08-01T11:00:00.000Z');
  });

  it('baselines historical activity so rows are not unread on first load', () => {
    const group = [
      thread({
        id: 'a',
        worktreePath: '/wt',
        messages: [{ role: 'agent', text: 'old', ts: '2026-08-01T10:00:00.000Z' }],
      }),
    ];
    expect(baselineUnreadWorktrees(group)).toBe(true);
    expect(getWorktreeLastSeen('/wt')).toBe('2026-08-01T10:00:00.000Z');
    expect(isWorktreeUnread('/wt', '2026-08-01T10:00:00.000Z', { active: false })).toBe(
      false,
    );
  });

  it('marks unread after a newer agent response until seen', () => {
    expect(markWorktreeSeen('/wt', '2026-08-01T10:00:00.000Z')).toBe(true);
    expect(
      isWorktreeUnread('/wt', '2026-08-01T10:05:00.000Z', { active: false }),
    ).toBe(true);
    expect(
      isWorktreeUnread('/wt', '2026-08-01T10:05:00.000Z', { active: true }),
    ).toBe(false);
    expect(markWorktreeSeen('/wt', '2026-08-01T10:05:00.000Z')).toBe(true);
    expect(
      isWorktreeUnread('/wt', '2026-08-01T10:05:00.000Z', { active: false }),
    ).toBe(false);
  });
});
