/**
 * Persist last-open chat tab and drag-reorder for a worktree (or the
 * orchestration group). Client-only localStorage — same idea as unread
 * last-seen and right-sidebar layout.
 */

import type { Thread } from '@sideboard-ai/core';
import { unreadWorktreeKey } from './unread-worktrees';

const STORAGE_KEY = 'sideboard.worktreeTabs';

export type WorktreeTabPrefs = {
  lastChatId?: string;
  chatOrder?: string[];
};

function normalizeKey(key: string): string {
  return key.replace(/\/+$/, '') || key;
}

function isPrefs(value: unknown): value is WorktreeTabPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (rec.lastChatId !== undefined && typeof rec.lastChatId !== 'string') return false;
  if (rec.chatOrder !== undefined) {
    if (!Array.isArray(rec.chatOrder)) return false;
    if (rec.chatOrder.some((id) => typeof id !== 'string')) return false;
  }
  return true;
}

function readMap(): Record<string, WorktreeTabPrefs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, WorktreeTabPrefs> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isPrefs(v)) continue;
      const lastChatId = typeof v.lastChatId === 'string' && v.lastChatId.trim() ? v.lastChatId.trim() : undefined;
      const chatOrder = Array.isArray(v.chatOrder)
        ? v.chatOrder.map((id) => id.trim()).filter(Boolean)
        : undefined;
      if (!lastChatId && !chatOrder?.length) continue;
      out[normalizeKey(k)] = {
        ...(lastChatId ? { lastChatId } : {}),
        ...(chatOrder?.length ? { chatOrder } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, WorktreeTabPrefs>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

export function readWorktreeTabPrefs(key: string): WorktreeTabPrefs {
  if (!key.trim()) return {};
  return readMap()[normalizeKey(key)] ?? {};
}

export function writeWorktreeTabPrefs(key: string, patch: WorktreeTabPrefs): void {
  const k = normalizeKey(key);
  if (!k) return;
  const map = readMap();
  const prev = map[k] ?? {};
  const lastChatId =
    patch.lastChatId !== undefined
      ? patch.lastChatId.trim() || undefined
      : prev.lastChatId;
  const chatOrder =
    patch.chatOrder !== undefined
      ? patch.chatOrder.map((id) => id.trim()).filter(Boolean)
      : prev.chatOrder;
  const next: WorktreeTabPrefs = {
    ...(lastChatId ? { lastChatId } : {}),
    ...(chatOrder?.length ? { chatOrder } : {}),
  };
  if (!next.lastChatId && !next.chatOrder?.length) delete map[k];
  else map[k] = next;
  writeMap(map);
}

export function writeLastWorktreeChatId(key: string, chatId: string): void {
  writeWorktreeTabPrefs(key, { lastChatId: chatId });
}

export function writeWorktreeChatOrder(key: string, chatOrder: string[]): void {
  writeWorktreeTabPrefs(key, { chatOrder });
}

/** Created-at order, then any saved drag order (unknown ids append at the end). */
export function orderWorktreeChats<T extends { id: string; createdAt: string }>(
  threads: readonly T[],
  order: readonly string[] | null | undefined,
): T[] {
  const created = [...threads].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  if (!order?.length) return created;
  const byId = new Map(created.map((t) => [t.id, t]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const t = byId.get(id);
    if (!t || seen.has(id)) continue;
    out.push(t);
    seen.add(id);
  }
  for (const t of created) {
    if (!seen.has(t.id)) out.push(t);
  }
  return out;
}

export function orderWorktreeChatsForKey<T extends { id: string; createdAt: string }>(
  threads: readonly T[],
  key: string,
): T[] {
  return orderWorktreeChats(threads, readWorktreeTabPrefs(key).chatOrder);
}

/**
 * Chat to open for a worktree row/card: the current selection if it is in the
 * group, else the last tab you had open, else the oldest chat.
 */
export function pickWorktreeChat<
  T extends { id: string; createdAt: string; worktreePath: string; repoPath: string },
>(group: readonly T[], selectedId?: string | null): T | undefined {
  if (group.length === 0) return undefined;
  if (selectedId) {
    const current = group.find((t) => t.id === selectedId);
    if (current) return current;
  }
  const key = unreadWorktreeKey(group[0]!);
  const lastId = key ? readWorktreeTabPrefs(key).lastChatId : undefined;
  if (lastId) {
    const remembered = group.find((t) => t.id === lastId);
    if (remembered) return remembered;
  }
  return orderWorktreeChats(group, null)[0];
}

/** Move `fromId` before/after `targetId`. No-op when ids are missing or equal. */
export function reorderChatIds(
  ids: readonly string[],
  fromId: string,
  targetId: string,
  place: 'before' | 'after',
): string[] {
  if (!fromId || !targetId || fromId === targetId) return [...ids];
  const next = ids.filter((id) => id !== fromId);
  const targetIdx = next.indexOf(targetId);
  if (targetIdx < 0 || !ids.includes(fromId)) return [...ids];
  next.splice(place === 'before' ? targetIdx : targetIdx + 1, 0, fromId);
  return next;
}

export { unreadWorktreeKey as worktreeTabKey };
