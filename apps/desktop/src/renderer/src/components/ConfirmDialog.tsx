interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Disable both actions while an async confirm is in flight. */
  busy?: boolean;
  /** Shown under the message while busy (defaults to a generic working label). */
  busyMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  busyMessage,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className={`modal confirm-modal${busy ? ' is-busy' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-message">{message}</p>
        {busy ? (
          <div className="confirm-dialog-busy" role="status">
            <span className="confirm-dialog-spinner" aria-hidden />
            <span>{busyMessage ?? 'Working…'}</span>
          </div>
        ) : null}
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
          <button type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
