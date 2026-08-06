import { CreateProcessingOverlay } from './CreateProcessingOverlay';

interface Props {
  prNumber: string | null;
  prTitle?: string | null;
  branch: string;
  target?: string | null;
  isDraft: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirm + processing UI for merging a PR (mirrors create-thread overlay). */
export function MergeModal({
  prNumber,
  prTitle,
  branch,
  target,
  isDraft,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const title = prNumber ? `Merge #${prNumber}?` : 'Merge pull request?';
  const hint = prNumber ? `PR #${prNumber}` : branch;

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className={`modal create-modal merge-modal${busy ? ' is-creating' : ''}`}
        role="dialog"
        aria-label={title}
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
      >
        {busy ? (
          <CreateProcessingOverlay
            mode="merge"
            repoName={branch.replace(/^thread\//, '')}
            selectionHint={hint}
          />
        ) : null}

        <div className={`create-modal-content${busy ? ' veiled' : ''}`}>
          <h3 className="merge-modal-title">{title}</h3>
          {prTitle ? <p className="merge-modal-subtitle">{prTitle}</p> : null}
          <p className="confirm-dialog-message">
            Squash-merge this pull request on GitHub
            {isDraft ? '. It will be marked ready first (drafts can’t be merged).' : '.'} The
            button will switch to Live when it succeeds.
          </p>
          <dl className="land-confirm-meta">
            <div>
              <dt>Branch</dt>
              <dd>
                <span className="land-confirm-branch">{branch}</span>
                {target ? (
                  <>
                    <span className="land-confirm-arrow">→</span>
                    <span>{target}</span>
                  </>
                ) : null}
              </dd>
            </div>
            {isDraft ? (
              <div>
                <dt>Status</dt>
                <dd>Draft → Ready</dd>
              </div>
            ) : null}
          </dl>
          {error ? <p className="land-confirm-error">{error}</p> : null}
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
            <button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? 'Merging…' : error ? 'Retry merge' : 'Merge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
