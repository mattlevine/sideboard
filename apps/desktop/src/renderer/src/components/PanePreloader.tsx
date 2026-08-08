import { ActivityMark } from './ActivityMark';

/** Centered chat-style logo + label + dots for pane loading states. */
export function PanePreloader({ label }: { label: string }) {
  return (
    <div className="pane-preloader" role="status" aria-live="polite">
      <ActivityMark tone="active" size="md" className="pane-preloader-mark" />
      <span className="pane-preloader-caption">
        <span className="thinking-indicator-label">{label}</span>
        <span className="thinking-indicator-dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}
