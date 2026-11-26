export function ComputerUseSetting(props: {
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="settings-section">
      <div className="settings-toggle-row">
        <div>
          <div className="settings-section-title">Computer use</div>
          <p className="settings-hint">
            Let an agent screenshot, click, and type on this Mac to test a running app, including
            how the screen looks. Off by default. Turning this on asks macOS to allow Sideboard to
            control this Mac and record the screen. Allow Sideboard. This is not design mode.
          </p>
        </div>
        <button
          type="button"
          className={`settings-switch${props.on ? ' on' : ''}`}
          role="switch"
          aria-checked={props.on}
          disabled={props.disabled}
          onClick={props.onToggle}
        >
          <span className="settings-switch-knob" />
        </button>
      </div>
    </div>
  );
}
