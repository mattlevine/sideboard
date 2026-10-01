/**
 * Persist the chat right-column (artifact/schema/files) width per worktree.
 * Unset worktrees use a stable default — not another worktree's last drag.
 */

const RIGHT_COLUMN_BY_WORKTREE_KEY = 'sideboard.rightColumnWidthByWorktree';
/** Legacy fallback when no worktree key is available. */
const RIGHT_COLUMN_GLOBAL_KEY = 'sideboard.rightColumnWidth';

export const RIGHT_COLUMN_MIN = 320;
export const RIGHT_COLUMN_MAX = 1400;
export const RIGHT_COLUMN_WIDTH_FALLBACK = 420;

function normalizeWorktreeKey(key: string): string {
  return key.replace(/\/+$/, '');
}

function clampRightColumnWidth(n: number): number {
  return Math.min(RIGHT_COLUMN_MAX, Math.max(RIGHT_COLUMN_MIN, Math.round(n)));
}

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RIGHT_COLUMN_BY_WORKTREE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[normalizeWorktreeKey(k)] = clampRightColumnWidth(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(RIGHT_COLUMN_BY_WORKTREE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

function readGlobalRightColumnWidth(): number | null {
  try {
    const raw = localStorage.getItem(RIGHT_COLUMN_GLOBAL_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clampRightColumnWidth(n);
  } catch {
    return null;
  }
}

export function hasStoredRightColumnWidth(
  worktreeKey: string | null | undefined,
): boolean {
  if (worktreeKey) {
    const map = readMap();
    return typeof map[normalizeWorktreeKey(worktreeKey)] === 'number';
  }
  return readGlobalRightColumnWidth() != null;
}

/** Half the chat workspace — used the first time an artifact column opens. */
export function firstOpenRightColumnWidth(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return RIGHT_COLUMN_WIDTH_FALLBACK;
  }
  return clampRightColumnWidth(containerWidth / 2);
}

/** Per-worktree right column width; missing keys use fallback (then legacy global). */
export function readRightColumnWidth(
  worktreeKey: string | null | undefined,
  fallback: number = RIGHT_COLUMN_WIDTH_FALLBACK,
): number {
  if (worktreeKey) {
    const map = readMap();
    const key = normalizeWorktreeKey(worktreeKey);
    const hit = map[key];
    if (typeof hit === 'number') return hit;
    return clampRightColumnWidth(fallback);
  }
  return readGlobalRightColumnWidth() ?? clampRightColumnWidth(fallback);
}

/** Remember width for this worktree only. */
export function writeRightColumnWidth(
  worktreeKey: string | null | undefined,
  width: number,
): void {
  const clamped = clampRightColumnWidth(width);
  if (worktreeKey) {
    const map = readMap();
    map[normalizeWorktreeKey(worktreeKey)] = clamped;
    writeMap(map);
    return;
  }
  try {
    localStorage.setItem(RIGHT_COLUMN_GLOBAL_KEY, String(clamped));
  } catch {
    // ignore
  }
}
