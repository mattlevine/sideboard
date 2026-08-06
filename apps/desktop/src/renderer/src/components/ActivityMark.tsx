import { BrandMark } from './BrandMark';

/** Pulsing / spinning Sideboard mark for live agent activity (Claude-style presence). */
export function ActivityMark({
  className = '',
  size = 'sm',
  tone = 'active',
}: {
  className?: string;
  size?: 'sm' | 'md';
  /** Softer pulse while queued; full spin+pulse while running. */
  tone?: 'active' | 'queued';
}) {
  return (
    <span
      className={`activity-mark activity-mark-${size} activity-mark-${tone}${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <span className="activity-mark-glow" />
      <BrandMark size={size} className="activity-mark-brand" />
    </span>
  );
}
