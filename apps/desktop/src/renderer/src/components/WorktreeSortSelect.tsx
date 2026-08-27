import type { WorktreeSortMode } from '@sideboard/home-board';
import { WORKTREE_SORT_OPTIONS } from '../lib/worktree-sort';

export function WorktreeSortSelect({
  value,
  onChange,
  className,
}: {
  value: WorktreeSortMode;
  onChange: (mode: WorktreeSortMode) => void;
  className?: string;
}) {
  return (
    <label className={className ?? 'worktree-sort'}>
      <span className="worktree-sort-label">Sort</span>
      <select
        className="worktree-sort-select"
        value={value}
        aria-label="Sort worktrees"
        onChange={(e) => onChange(e.target.value as WorktreeSortMode)}
      >
        {WORKTREE_SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
