interface Props {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
  className?: string;
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  const d = dir === 'left' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13';
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarToggle({ side, open, onClick, className = '' }: Props) {
  const label = open
    ? side === 'left'
      ? 'Hide left sidebar'
      : 'Hide right sidebar'
    : side === 'left'
      ? 'Show left sidebar'
      : 'Show right sidebar';
  const dir: 'left' | 'right' = open
    ? side === 'left'
      ? 'left'
      : 'right'
    : side === 'left'
      ? 'right'
      : 'left';
  return (
    <button
      type="button"
      className={`sidebar-toggle${open ? ' active' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={open}
      onClick={onClick}
    >
      <Chevron dir={dir} />
    </button>
  );
}
