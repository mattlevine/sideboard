import { ActivityMark } from './ActivityMark';

/** Animated “Thinking…” status used while an agent turn is waiting / streaming. */
export function ThinkingIndicator({
  label = 'Thinking',
  queued = false,
  showMark = true,
}: {
  label?: string;
  /** Softer treatment for queued (not yet running) turns. */
  queued?: boolean;
  /** When false, omit the mark (e.g. parent renders it below the message). */
  showMark?: boolean;
}) {
  return (
    <span className={`thinking-indicator${queued ? ' queued' : ''}`} aria-live="polite">
      {showMark ? <ActivityMark tone={queued ? 'queued' : 'active'} size="sm" /> : null}
      <span className="thinking-indicator-label">
        {queued ? 'Queued' : <span className="thinking-wave">{label}</span>}
      </span>
    </span>
  );
}
