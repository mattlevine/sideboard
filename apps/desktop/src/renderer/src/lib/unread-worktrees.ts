/**
 * Conductor-style unread worktrees: a sidebar row looks unread when an agent
 * response arrived after you last opened that worktree. Clicking in marks it seen.
 * Client-only (localStorage) — project headers stay visually separate.
 */

import type { Thread } from '@sideboard-ai/core';

const STORAGE_KEY = 'sideboard.lastSeenByWorktree';

function normalizeKey(key: string): string {
  return key.replace(/\/+$/, '') || key;
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[normalizeKey(k)] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

export function unreadWorktreeKey(thread: Pick<Thread, 'worktreePath' | 'repoPath'>): string {
  const wt = thread.worktreePath?.trim();
  if (wt) return normalizeKey(wt);
  return normalizeKey(thread.repoPath || '');
}

/** Latest agent message timestamp in the group (Conductor: “responses you haven’t seen”). */
export function latestAgentResponseAt(threads: Thread[]): string | null {
  let max = '';
  for (const t of threads) {
    for (const m of t.messages ?? []) {
      if (m.role === 'agent' && typeof m.ts === 'string' && m.ts > max) max = m.ts;
    }
  }
  return max || null;
}

export function getWorktreeLastSeen(key: string): string | null {
  const v = readMap()[normalizeKey(key)];
  return v ?? null;
}

export function markWorktreeSeen(key: string, at: string = new Date().toISOString()): boolean {
  const k = normalizeKey(key);
  if (!k) return false;
  const map = readMap();
  if (map[k] === at) return false;
  map[k] = at;
  writeMap(map);
  return true;
}

/**
 * Seed last-seen for worktrees that have never been recorded so historical
 * rows don’t all flash unread on first launch — only future responses do.
 * @returns true when any key was written
 */
export function baselineUnreadWorktrees(threads: Thread[]): boolean {
  if (threads.length === 0) return false;
  const byKey = new Map<string, Thread[]>();
  for (const t of threads) {
    const key = unreadWorktreeKey(t);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }
  const map = readMap();
  let changed = false;
  for (const [key, group] of byKey) {
    if (map[key]) continue;
    const activity = latestAgentResponseAt(group);
    if (!activity) continue;
    map[key] = activity;
    changed = true;
  }
  if (changed) writeMap(map);
  return changed;
}

export function isWorktreeUnread(
  key: string,
  activityAt: string | null,
  opts: { active: boolean },
): boolean {
  if (opts.active || !activityAt || !key) return false;
  const seen = getWorktreeLastSeen(key);
  if (seen == null) return false;
  return activityAt > seen;
}
