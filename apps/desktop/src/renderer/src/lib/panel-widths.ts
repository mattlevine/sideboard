/** Persist resizable panel widths so returning to a thread keeps layout. */

const RIGHT_COLUMN_BY_THREAD_KEY = 'sideboard.rightColumnWidthByThread';
const RIGHT_COLUMN_GLOBAL_KEY = 'sideboard.rightColumnWidth';

const RIGHT_COLUMN_MIN = 320;
const RIGHT_COLUMN_MAX = 900;
export const RIGHT_COLUMN_WIDTH_FALLBACK = 420;

function clampRightColumnWidth(n: number): number {
  return Math.min(RIGHT_COLUMN_MAX, Math.max(RIGHT_COLUMN_MIN, Math.round(n)));
}

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RIGHT_COLUMN_BY_THREAD_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = clampRightColumnWidth(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(RIGHT_COLUMN_BY_THREAD_KEY, JSON.stringify(map));
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

/** Per-thread right column width, falling back to last global width then default. */
export function readRightColumnWidth(
  threadId: string,
  fallback: number = RIGHT_COLUMN_WIDTH_FALLBACK,
): number {
  const map = readMap();
  const hit = map[threadId];
  if (typeof hit === 'number') return hit;
  return readGlobalRightColumnWidth() ?? clampRightColumnWidth(fallback);
}

/** Remember width for this thread and as the global default for new threads. */
export function writeRightColumnWidth(threadId: string, width: number): void {
  const clamped = clampRightColumnWidth(width);
  const map = readMap();
  map[threadId] = clamped;
  writeMap(map);
  try {
    localStorage.setItem(RIGHT_COLUMN_GLOBAL_KEY, String(clamped));
  } catch {
    // ignore
  }
}
