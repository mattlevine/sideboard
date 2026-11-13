export function SettingsNumberField({
  id,
  title,
  hint,
  value,
  saved,
  busy,
  onChange,
  onError,
  invalidMessage,
  onSave,
}: {
  id: string;
  title: string;
  hint: string;
  value: string;
  saved: number;
  busy: boolean;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  invalidMessage: string;
  onSave: (n: number) => void;
}) {
  return (
    <div className="settings-section">
      <label className="settings-section-title" htmlFor={id}>
        {title}
      </label>
      <p className="settings-hint">{hint}</p>
      <div className="settings-key-row" style={{ marginTop: '0.5rem' }}>
        <input
          id={id}
          type="number"
          min={1}
          max={32}
          step={1}
          value={value}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="primary"
          disabled={busy || !value.trim() || Number(value) === saved}
          onClick={() => {
            const n = Number(value);
            if (!Number.isFinite(n)) {
              onError(invalidMessage);
              return;
            }
            onSave(n);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
