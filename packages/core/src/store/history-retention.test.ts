import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/thread.js';
import { createEmptyThread } from './thread-store.js';
import {
  HISTORY_DISCARDED_TEXT,
  HISTORY_MAX_COUNT_DEFAULT,
  historyRetentionStubMessage,
  isHistoryRetentionStub,
  planHistoryAgePurge,
  planHistoryRetention,
} from './history-retention.js';

function archived(partial: {
  id?: string;
  updatedAt: string;
  archivedAt?: string;
  messages?: Thread['messages'];
  attachments?: Thread['attachments'];
}): Thread {
  const thread = createEmptyThread({
    title: partial.id ?? 'chat',
    sourceType: 'branch',
    sourceRef: 'main',
    branchName: 'thread/chat',
    worktreePath: '/tmp/chat',
    repoPath: '/tmp/repo',
    agent: 'claude',
    status: 'archived',
  });
  return {
    ...thread,
    id: partial.id ?? thread.id,
    updatedAt: partial.updatedAt,
    archivedAt: partial.archivedAt,
    messages: partial.messages ?? [
      { role: 'user', text: 'ship it', ts: partial.updatedAt },
    ],
    attachments: partial.attachments ?? [],
  };
}

describe('planHistoryRetention', () => {
  it('keeps the newest maxCount and strips older transcripts first', () => {
    const plan = planHistoryRetention(
      [
        archived({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
        archived({ id: 'mid', updatedAt: '2026-02-01T00:00:00.000Z' }),
        archived({ id: 'new', updatedAt: '2026-03-01T00:00:00.000Z' }),
      ],
      { maxCount: 2, maxDays: 0 },
    );
    expect(plan.stripIds).toEqual(['old']);
    expect(plan.purgeIds).toEqual([]);
  });

  it('purges overflow that is already a retention stub', () => {
    const stub = archived({
      id: 'stub',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [{ role: 'summary', text: HISTORY_DISCARDED_TEXT, ts: '2026-01-01T00:00:00.000Z' }],
    });
    const plan = planHistoryRetention(
      [
        stub,
        archived({ id: 'keep-a', updatedAt: '2026-02-01T00:00:00.000Z' }),
        archived({ id: 'keep-b', updatedAt: '2026-03-01T00:00:00.000Z' }),
      ],
      { maxCount: 2, maxDays: 0 },
    );
    expect(plan.stripIds).toEqual([]);
    expect(plan.purgeIds).toEqual(['stub']);
  });

  it('ages from archivedAt even if updatedAt moved later', () => {
    const plan = planHistoryRetention(
      [
        archived({
          id: 'stamped',
          updatedAt: '2026-02-20T00:00:00.000Z',
          archivedAt: '2025-01-01T00:00:00.000Z',
        }),
      ],
      { maxCount: 200, maxDays: 30, nowMs: Date.parse('2026-03-01T00:00:00.000Z') },
    );
    expect(plan.purgeIds).toEqual(['stamped']);
    expect(plan.stripIds).toEqual([]);
  });

  it('purges age-expired rows even when under the count cap', () => {
    const plan = planHistoryRetention(
      [archived({ id: 'ancient', updatedAt: '2025-01-01T00:00:00.000Z' })],
      { maxCount: 200, maxDays: 30, nowMs: Date.parse('2026-03-01T00:00:00.000Z') },
    );
    expect(plan.purgeIds).toEqual(['ancient']);
    expect(plan.stripIds).toEqual([]);
  });

  it('defaults to keeping 200 and never age-purging', () => {
    expect(HISTORY_MAX_COUNT_DEFAULT).toBe(200);
    const many = Array.from({ length: 200 }, (_, i) =>
      archived({
        id: `t${i}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      }),
    );
    const plan = planHistoryRetention(many, {});
    expect(plan.stripIds).toEqual([]);
    expect(plan.purgeIds).toEqual([]);
  });
});

describe('planHistoryAgePurge', () => {
  it('returns oldest-first ids older than N days', () => {
    const ids = planHistoryAgePurge(
      [
        archived({ id: 'keep', updatedAt: '2026-02-20T00:00:00.000Z' }),
        archived({ id: 'old-b', updatedAt: '2026-01-20T00:00:00.000Z' }),
        archived({ id: 'old-a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      ],
      30,
      Date.parse('2026-03-01T00:00:00.000Z'),
    );
    expect(ids).toEqual(['old-a', 'old-b']);
  });

  it('treats 0 days as a no-op', () => {
    expect(
      planHistoryAgePurge([archived({ id: 'x', updatedAt: '2020-01-01T00:00:00.000Z' })], 0),
    ).toEqual([]);
  });
});

describe('history retention stub', () => {
  it('folds billed usage onto the discarded summary', () => {
    const thread = archived({
      id: 'fat',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [
        {
          role: 'agent',
          text: 'done',
          ts: '2026-01-01T00:00:00.000Z',
          usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.02 },
        },
      ],
    });
    const stub = historyRetentionStubMessage(thread);
    expect(stub.text).toBe(HISTORY_DISCARDED_TEXT);
    expect(stub.usage).toMatchObject({ inputTokens: 10, outputTokens: 4, costUsd: 0.02 });
    expect(isHistoryRetentionStub({ messages: [stub], attachments: [] })).toBe(true);
    expect(isHistoryRetentionStub(thread)).toBe(false);
  });
});
