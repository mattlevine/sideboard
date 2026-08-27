import {
  DEFAULT_WORKTREE_SORT,
  type WorktreeSortMode,
} from '@sideboard/home-board';

const STORAGE_KEY = 'sideboard.worktreeSort';

export const WORKTREE_SORT_OPTIONS: { value: WorktreeSortMode; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'name', label: 'Name' },
  { value: 'activity', label: 'Recent activity' },
];

export function isWorktreeSortMode(value: string): value is WorktreeSortMode {
  return value === 'created' || value === 'name' || value === 'activity';
}

export function readWorktreeSort(): WorktreeSortMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isWorktreeSortMode(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_WORKTREE_SORT;
}

export function writeWorktreeSort(mode: WorktreeSortMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
