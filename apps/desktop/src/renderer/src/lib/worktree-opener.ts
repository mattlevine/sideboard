import type { WorktreeOpener, WorktreeOpenerId } from '@sideboard-ai/core';

const STORAGE_KEY = 'sideboard.worktreeOpener';

export const FALLBACK_WORKTREE_OPENERS: WorktreeOpener[] = [
  { id: 'finder', label: 'Finder', kbd: '1', installed: true },
  { id: 'cursor', label: 'Cursor', kbd: '2', installed: true },
  { id: 'code', label: 'VS Code', kbd: '3', installed: false },
  { id: 'xcode', label: 'Xcode', kbd: '4', installed: false },
  { id: 'terminal', label: 'Terminal', kbd: '5', installed: true },
  { id: 'datagrip', label: 'DataGrip', kbd: '6', installed: false },
];

/** Drop missing apps and number 1–N in remaining order. */
export function installedWorktreeOpeners(openers: WorktreeOpener[]): WorktreeOpener[] {
  return openers.filter((o) => o.installed).map((o, i) => ({ ...o, kbd: String(i + 1) }));
}

export function copyWorktreePathKbd(openers: Array<{ id: string }>): string {
  return String(openers.length + 1);
}

export type WorktreeOpenShortcut =
  | { type: 'open'; id: WorktreeOpenerId }
  | { type: 'copy' };

/** Menu digits 1–N in list order (while the cube menu is open) plus global ⌘O → Cursor. */
export function matchWorktreeOpenShortcut(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  openers: Array<{ id: WorktreeOpenerId }>,
  menuOpen: boolean,
): WorktreeOpenShortcut | null {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'o') {
    return { type: 'open', id: 'cursor' };
  }
  if (!menuOpen || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (!/^[1-9]$/.test(e.key)) return null;
  const n = Number(e.key);
  if (n === openers.length + 1) return { type: 'copy' };
  const opener = openers[n - 1];
  return opener ? { type: 'open', id: opener.id } : null;
}

const IDS = new Set<WorktreeOpenerId>(FALLBACK_WORKTREE_OPENERS.map((o) => o.id));

export function isWorktreeOpenerId(value: string): value is WorktreeOpenerId {
  return IDS.has(value as WorktreeOpenerId);
}

/** Last cube target (defaults to Cursor, matching ⌘O). */
export function readLastWorktreeOpener(): WorktreeOpenerId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isWorktreeOpenerId(raw)) return raw;
  } catch {
    /* ignore quota / private mode */
  }
  return 'cursor';
}

export function writeLastWorktreeOpener(id: WorktreeOpenerId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Prefer the last-used app’s real icon; otherwise the first opener that has one. */
export function pickTriggerOpener(
  openers: WorktreeOpener[],
  lastId: WorktreeOpenerId,
): WorktreeOpener | undefined {
  const visible = installedWorktreeOpeners(openers);
  const last = visible.find((o) => o.id === lastId);
  if (last?.iconDataUrl) return last;
  return visible.find((o) => o.iconDataUrl) ?? last ?? visible[0];
}
