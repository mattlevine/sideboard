import { DictationMicButton } from './DictationMicButton';

export function CreateModalFooterActions({
  dictation,
  busy,
  createMore,
  onToggleCreateMore,
  canSubmit,
  onSubmit,
}: {
  dictation: {
    listening: boolean;
    supported: boolean;
    error: string | null;
    start: () => void;
    stop: () => void;
  };
  busy: boolean;
  createMore: boolean;
  onToggleCreateMore: () => void;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  return (
    <>
      <DictationMicButton
        listening={dictation.listening}
        supported={dictation.supported}
        error={dictation.error}
        disabled={busy}
        onStart={dictation.start}
        onStop={dictation.stop}
      />
      <label className="create-more-toggle" title="Keep dialog open after create">
        <button
          type="button"
          className={`settings-switch create-more-switch${createMore ? ' on' : ''}`}
          role="switch"
          aria-checked={createMore}
          disabled={busy}
          onClick={onToggleCreateMore}
        >
          <span className="settings-switch-knob" />
        </button>
        <span>Create more</span>
      </label>
      <button
        type="button"
        className={`create-submit-btn${busy ? ' is-busy' : ''}`}
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {busy ? (
          <>
            <span className="create-submit-spinner" aria-hidden />
            Creating
          </>
        ) : (
          <>
            Create <kbd>↵</kbd>
          </>
        )}
      </button>
    </>
  );
}
