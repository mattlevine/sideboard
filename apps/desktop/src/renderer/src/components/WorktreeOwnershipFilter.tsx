import { useRef, useState } from 'react';
import type { BoardOwnershipFilter } from '@sideboard/home-board';
import { WORKTREE_OWNERSHIP_OPTIONS } from '../lib/worktree-ownership';
import { FloatingMenu } from './FloatingMenu';

export function WorktreeOwnershipFilter({
  value,
  onChange,
  className,
  variant = 'segmented',
  githubLogin,
}: {
  value: BoardOwnershipFilter;
  onChange: (filter: BoardOwnershipFilter) => void;
  className?: string;
  variant?: 'segmented' | 'icon';
  githubLogin?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = WORKTREE_OWNERSHIP_OPTIONS.find((opt) => opt.value === value);
  const currentLabel = current?.label ?? value;
  const connected = Boolean(githubLogin?.trim());
  const title = connected
    ? `Show worktrees (${currentLabel}) — GitHub @${githubLogin}`
    : `Show worktrees (${currentLabel}) — connect GitHub to tell yours from reviews`;

  if (variant === 'icon') {
    return (
      <>
        <button
          ref={btnRef}
          type="button"
          className={`icon-btn${open || value !== 'all' ? ' active' : ''}${className ? ` ${className}` : ''}`}
          title={title}
          aria-label={title}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ownership-glyph" aria-hidden />
        </button>
        <FloatingMenu
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={btnRef}
          align="right"
          placement="down"
          minWidth={188}
          className="worktree-sort-menu"
        >
          {WORKTREE_OWNERSHIP_OPTIONS.map((opt) => {
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
    <div
      className={className ?? 'worktree-ownership'}
      role="group"
      aria-label="Show mine or reviewing"
      title={title}
    >
      <span className="worktree-sort-label">Show</span>
      <div className="worktree-ownership-tabs">
        {WORKTREE_OWNERSHIP_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={value === opt.value ? 'active' : ''}
            title={opt.hint}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
