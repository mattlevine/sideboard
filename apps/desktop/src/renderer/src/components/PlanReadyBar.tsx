interface Props {
  busy?: boolean;
  onCopy: () => void;
  onHandOff: () => void;
  onApprove: () => void;
}

/**
 * Conductor-style plan approval chrome in the composer:
 * Copy · Hand off (new chat) · Approve (implement here).
 * Composer text is included as notes on Approve / Hand off.
 */
export function PlanReadyBar({
  busy = false,
  onCopy,
  onHandOff,
  onApprove,
}: Props) {
  return (
    <div className="plan-ready-bar" role="toolbar" aria-label="Plan actions">
      <button
        type="button"
        className="plan-ready-btn"
        disabled={busy}
        title="Copy plan"
        onClick={onCopy}
      >
        <span className="plan-ready-icon" aria-hidden>
          ⎘
        </span>
        Copy
      </button>
      <button
        type="button"
        className="plan-ready-btn"
        disabled={busy}
        title="Fork to a new chat and implement (includes composer notes)"
        onClick={onHandOff}
      >
        <span className="plan-ready-icon" aria-hidden>
          ↝
        </span>
        Hand off
      </button>
      <button
        type="button"
        className="plan-ready-btn plan-ready-approve"
        disabled={busy}
        title="Approve and implement in this chat (⌘⇧↵). Composer text is sent as notes."
        onClick={onApprove}
      >
        Approve
        <kbd>⌘⇧↵</kbd>
      </button>
    </div>
  );
}
