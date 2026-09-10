import {
  DEFAULT_BOARD_OWNERSHIP,
  type BoardOwnershipFilter,
} from '@sideboard/home-board';

const STORAGE_KEY = 'sideboard.worktreeOwnership';

export const WORKTREE_OWNERSHIP_OPTIONS: {
  value: BoardOwnershipFilter;
  label: string;
  hint: string;
}[] = [
  { value: 'all', label: 'All', hint: 'Your work and PRs you are reviewing' },
  { value: 'mine', label: 'Mine', hint: 'PRs you authored, or local work with no PR' },
  { value: 'reviewing', label: 'Reviewing', hint: "Someone else's PR" },
];

export function isBoardOwnershipFilter(value: string): value is BoardOwnershipFilter {
  return value === 'all' || value === 'mine' || value === 'reviewing';
}

export function readWorktreeOwnership(): BoardOwnershipFilter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isBoardOwnershipFilter(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_BOARD_OWNERSHIP;
}

export function writeWorktreeOwnership(filter: BoardOwnershipFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, filter);
  } catch {
    // ignore
  }
}
