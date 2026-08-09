/**
 * Persist right-sidebar open/closed and width per worktree path.
 * Unset worktrees use stable defaults — never inherit another worktree's layout.
 */

const OPEN_BY_WORKTREE_KEY = 'sideboard.rightSidebarOpenByWorktree';
const WIDTH_BY_WORKTREE_KEY = 'sideboard.rightSidebarWidthByWorktree';
/** Legacy app-wide keys; only used when no worktree is selected (board view). */
const OPEN_GLOBAL_KEY = 'sideboard.rightSidebar';
const WIDTH_GLOBAL_KEY = 'sideboard.rightSidebarWidth';

const WIDTH_MIN = 240;
const WIDTH_MAX = 560;
export const RIGHT_SIDEBAR_WIDTH_FALLBACK = 340;

function normalizeWorktreeKey(key: string): string {
  return key.replace(/\/+$/, '');
}

function clampWidth(n: number): number {
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(n)));
}

function readBoolMap(storageKey: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const nk = normalizeWorktreeKey(k);
      if (typeof v === 'boolean') out[nk] = v;
      else if (v === 0 || v === 1 || v === '0' || v === '1') out[nk] = v === 1 || v === '1';
    }
    return out;
  } catch {
    return {};
  }
}

function writeBoolMap(storageKey: string, map: Record<string, boolean>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function readNumMap(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[normalizeWorktreeKey(k)] = clampWidth(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeNumMap(storageKey: string, map: Record<string, number>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function readGlobalOpen(fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(OPEN_GLOBAL_KEY);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeGlobalOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_GLOBAL_KEY, open ? '1' : '0');
  } catch {
    // ignore
  }
}

function readGlobalWidth(fallback: number): number {
  try {
    const raw = localStorage.getItem(WIDTH_GLOBAL_KEY);
    if (raw == null) return clampWidth(fallback);
    const n = Number(raw);
    if (!Number.isFinite(n)) return clampWidth(fallback);
    return clampWidth(n);
  } catch {
    return clampWidth(fallback);
  }
}

function writeGlobalWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_GLOBAL_KEY, String(clampWidth(width)));
  } catch {
    // ignore
  }
}

/**
 * Per-worktree open state. Missing entries use `fallback` (default open)
 * — they do NOT inherit the last toggle from another worktree.
 */
export function readRightSidebarOpen(
  worktreeKey: string | null | undefined,
  fallback = true,
): boolean {
  if (worktreeKey) {
    const map = readBoolMap(OPEN_BY_WORKTREE_KEY);
    const key = normalizeWorktreeKey(worktreeKey);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return map[key]!;
    }
    return fallback;
  }
  return readGlobalOpen(fallback);
}

/** Remember open state for this worktree only (or global when key is null). */
export function writeRightSidebarOpen(
  worktreeKey: string | null | undefined,
  open: boolean,
): void {
  if (worktreeKey) {
    const map = readBoolMap(OPEN_BY_WORKTREE_KEY);
    map[normalizeWorktreeKey(worktreeKey)] = open;
    writeBoolMap(OPEN_BY_WORKTREE_KEY, map);
    return;
  }
  writeGlobalOpen(open);
}

/** Per-worktree sidebar width; missing keys use fallback (then legacy global). */
export function readRightSidebarWidth(
  worktreeKey: string | null | undefined,
  fallback: number = RIGHT_SIDEBAR_WIDTH_FALLBACK,
): number {
  if (worktreeKey) {
    const map = readNumMap(WIDTH_BY_WORKTREE_KEY);
    const key = normalizeWorktreeKey(worktreeKey);
    const hit = map[key];
    if (typeof hit === 'number') return hit;
    return clampWidth(fallback);
  }
  return readGlobalWidth(fallback);
}

/** Remember width for this worktree only (or global when key is null). */
export function writeRightSidebarWidth(
  worktreeKey: string | null | undefined,
  width: number,
): void {
  const clamped = clampWidth(width);
  if (worktreeKey) {
    const map = readNumMap(WIDTH_BY_WORKTREE_KEY);
    map[normalizeWorktreeKey(worktreeKey)] = clamped;
    writeNumMap(WIDTH_BY_WORKTREE_KEY, map);
    return;
  }
  writeGlobalWidth(clamped);
}
