import { ActivityMark } from './ActivityMark';

/** Animated “Thinking…” status used while an agent turn is waiting / streaming. */
export function ThinkingIndicator({
  label = 'Thinking',
  queued = false,
}: {
  label?: string;
  /** Softer treatment for queued (not yet running) turns. */
  queued?: boolean;
}) {
  return (
    <span className={`thinking-indicator${queued ? ' queued' : ''}`} aria-live="polite">
      <ActivityMark tone={queued ? 'queued' : 'active'} size="sm" />
      <span className="thinking-indicator-label">{queued ? 'Queued' : label}</span>
      <span className="thinking-indicator-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
