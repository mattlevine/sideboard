interface Props {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
  className?: string;
}

export function SidebarToggle({ side, open, onClick, className = '' }: Props) {
  const label = open
    ? side === 'left'
      ? 'Hide left sidebar'
      : 'Hide right sidebar'
    : side === 'left'
      ? 'Show left sidebar'
      : 'Show right sidebar';
  return (
    <button
      type="button"
      className={`sidebar-toggle${open ? ' active' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={open}
      onClick={onClick}
    >
      <span className={`sidebar-toggle-icon ${side}`} aria-hidden />
    </button>
  );
}
