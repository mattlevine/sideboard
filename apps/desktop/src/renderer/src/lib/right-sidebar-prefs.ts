/**
 * Persist right-sidebar open/closed per workspace (repo path), with a global
 * fallback — same pattern as per-thread right-column widths.
 */

const OPEN_BY_WORKSPACE_KEY = 'sideboard.rightSidebarOpenByWorkspace';
const OPEN_GLOBAL_KEY = 'sideboard.rightSidebar';

function readOpenMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_BY_WORKSPACE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
      else if (v === 0 || v === 1 || v === '0' || v === '1') out[k] = v === 1 || v === '1';
    }
    return out;
  } catch {
    return {};
  }
}

function writeOpenMap(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(OPEN_BY_WORKSPACE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
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

/** Per-workspace open state, falling back to the last global preference. */
export function readRightSidebarOpen(
  workspaceKey: string | null | undefined,
  fallback = true,
): boolean {
  if (workspaceKey) {
    const map = readOpenMap();
    if (Object.prototype.hasOwnProperty.call(map, workspaceKey)) {
      return map[workspaceKey]!;
    }
  }
  return readGlobalOpen(fallback);
}

/** Remember open state for this workspace and as the global default. */
export function writeRightSidebarOpen(
  workspaceKey: string | null | undefined,
  open: boolean,
): void {
  if (workspaceKey) {
    const map = readOpenMap();
    map[workspaceKey] = open;
    writeOpenMap(map);
  }
  writeGlobalOpen(open);
}
