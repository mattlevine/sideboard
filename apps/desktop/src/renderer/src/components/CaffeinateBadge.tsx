/** Yellow “awake” pill — same mark as chat tabs and the menu-bar caffeinate tray. */
export function CaffeinateBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`caffeinate-badge${className ? ` ${className}` : ''}`}
      title="Keeping this Mac awake (caffeinate)"
      aria-label="Keeping this Mac awake"
    >
      awake
    </span>
  );
}
