import { useRef, useState } from 'react';
import type { WorktreeSortMode } from '@sideboard/home-board';
import { WORKTREE_SORT_OPTIONS } from '../lib/worktree-sort';
import { FloatingMenu } from './FloatingMenu';

export function WorktreeSortSelect({
  value,
  onChange,
  className,
  variant = 'select',
}: {
  value: WorktreeSortMode;
  onChange: (mode: WorktreeSortMode) => void;
  className?: string;
  variant?: 'select' | 'icon';
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = WORKTREE_SORT_OPTIONS.find((opt) => opt.value === value);
  const currentLabel = current?.label ?? value;

  if (variant === 'icon') {
    return (
      <>
        <button
          ref={btnRef}
          type="button"
          className={`icon-btn${open ? ' active' : ''}${className ? ` ${className}` : ''}`}
          title={`Sort: ${currentLabel}`}
          aria-label={`Sort worktrees (${currentLabel})`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sort-glyph" aria-hidden />
        </button>
        <FloatingMenu
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={btnRef}
          align="right"
          placement="down"
          minWidth={168}
          className="worktree-sort-menu"
        >
          {WORKTREE_SORT_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={selected ? 'selected' : undefined}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="menu-item-label">{opt.label}</span>
                {selected ? <span className="worktree-sort-check">✓</span> : null}
              </button>
            );
          })}
        </FloatingMenu>
      </>
    );
  }

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
