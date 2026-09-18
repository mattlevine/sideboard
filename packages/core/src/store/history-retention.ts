import { sumUsageList } from '../agents/usage.js';
import type { Thread, ThreadMessage } from '../types/thread.js';

/** Newest archived chats to keep when the setting is omitted. */
export const HISTORY_MAX_COUNT_DEFAULT = 200;
export const HISTORY_MAX_COUNT_MIN = 1;
export const HISTORY_MAX_COUNT_MAX = 2_000;

/** 0 = no automatic age purge (default — avoid wiping old accounts on upgrade). */
export const HISTORY_MAX_DAYS_DEFAULT = 0;
export const HISTORY_MAX_DAYS_MAX = 3_650;

export const HISTORY_CLEANUP_INTERVAL_HOURS_DEFAULT = 6;

export const HISTORY_DISCARDED_TEXT = 'Transcript discarded by History retention.';

export interface HistoryRetentionPlan {
  /** Oldest overflow chats that still have a transcript — shrink, keep the row. */
  stripIds: string[];
  /** Age-expired, already-stripped overflow, or a manual clear. */
  purgeIds: string[];
}

export interface HistoryRetentionThresholds {
  maxCount?: number;
  /** 0 / omitted = no age purge. */
  maxDays?: number;
  nowMs?: number;
}

export function clampHistoryMaxCount(value: number): number {
  return Math.max(HISTORY_MAX_COUNT_MIN, Math.min(HISTORY_MAX_COUNT_MAX, Math.floor(value)));
}

export function clampHistoryMaxDays(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(HISTORY_MAX_DAYS_MAX, Math.floor(value));
}

export function archivedUpdatedMs(thread: Pick<Thread, 'updatedAt' | 'createdAt'>): number {
  const updated = Date.parse(thread.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(thread.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export function isHistoryRetentionStub(thread: Pick<Thread, 'messages' | 'attachments'>): boolean {
  if ((thread.attachments?.length ?? 0) > 0) return false;
  const messages = thread.messages ?? [];
  if (messages.length === 0) return true;
  if (messages.length > 1) return false;
  const only = messages[0]!;
  if (only.parts?.length) return false;
  if ((only.attachments?.length ?? 0) > 0) return false;
  const text = (only.text ?? '').trim();
  return text === '' || text === HISTORY_DISCARDED_TEXT;
}

export function historyRetentionStubMessage(thread: Pick<Thread, 'messages' | 'updatedAt'>): ThreadMessage {
  const usage = sumUsageList((thread.messages ?? []).map((m) => m.usage));
  return {
    role: 'summary',
    text: HISTORY_DISCARDED_TEXT,
    ts: thread.updatedAt,
    ...(usage ? { usage } : {}),
  };
}

function sortArchivedOldestFirst<T extends Pick<Thread, 'updatedAt' | 'createdAt'>>(
  threads: T[],
): T[] {
  return [...threads].sort((a, b) => archivedUpdatedMs(a) - archivedUpdatedMs(b));
}

/**
 * Worktree-style cap for Settings → History.
 *
 * Age-expired rows are purged. Count overflow is stripped first (keep the
 * searchable row) and purged on a later pass once it is already a stub.
 */
export function planHistoryRetention<T extends Pick<Thread, 'id' | 'updatedAt' | 'createdAt' | 'messages' | 'attachments'>>(
  archived: T[],
  thresholds: HistoryRetentionThresholds = {},
): HistoryRetentionPlan {
  const maxCount = clampHistoryMaxCount(thresholds.maxCount ?? HISTORY_MAX_COUNT_DEFAULT);
  const maxDays = clampHistoryMaxDays(thresholds.maxDays ?? HISTORY_MAX_DAYS_DEFAULT);
  const nowMs = thresholds.nowMs ?? Date.now();
  const oldestFirst = sortArchivedOldestFirst(archived);

  const expiredIds = new Set<string>();
  if (maxDays > 0) {
    const cutoff = nowMs - maxDays * 86_400_000;
    for (const thread of oldestFirst) {
      if (archivedUpdatedMs(thread) < cutoff) expiredIds.add(thread.id);
    }
  }

  const remaining = oldestFirst.filter((t) => !expiredIds.has(t.id));
  const overflow = remaining.length > maxCount ? remaining.slice(0, remaining.length - maxCount) : [];

  const stripIds: string[] = [];
  const purgeIds: string[] = [...expiredIds];
  const seenPurge = new Set(purgeIds);

  for (const thread of overflow) {
    if (isHistoryRetentionStub(thread)) {
      if (!seenPurge.has(thread.id)) {
        seenPurge.add(thread.id);
        purgeIds.push(thread.id);
      }
    } else {
      stripIds.push(thread.id);
    }
  }

  return { stripIds, purgeIds };
}

/** Manual History “Clear older than…” — purge those rows, do not strip. */
export function planHistoryAgePurge<T extends Pick<Thread, 'id' | 'updatedAt' | 'createdAt'>>(
  archived: T[],
  olderThanDays: number,
  nowMs = Date.now(),
): string[] {
  const days = clampHistoryMaxDays(olderThanDays);
  if (days <= 0) return [];
  const cutoff = nowMs - days * 86_400_000;
  return sortArchivedOldestFirst(archived)
    .filter((t) => archivedUpdatedMs(t) < cutoff)
    .map((t) => t.id);
}
