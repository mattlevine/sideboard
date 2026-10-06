import type { KeyboardEvent, MouseEvent } from 'react';
import { isDictationPermissionError } from '../lib/speech-dictation';

interface Props {
  listening: boolean;
  supported: boolean;
  error?: string | null;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function DictationMicButton({
  listening,
  supported,
  error,
  disabled,
  onStart,
  onStop,
}: Props) {
  const blocked = disabled || !supported;
  const title = !supported
    ? 'Dictation is not available'
    : listening
      ? 'Stop dictation'
      : isDictationPermissionError(error)
        ? 'Allow microphone'
        : error
          ? error
          : 'Dictate';

  function toggle(e: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (blocked) return;
    if (listening) onStop();
    else onStart();
  }

  return (
    <button
      type="button"
      className={`icon-round dictation-mic${listening ? ' listening' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={listening}
      disabled={blocked}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        if (e.repeat) return;
        toggle(e);
      }}
    >
      <svg
        className="dictation-mic-icon"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
        <path d="M8 22h8" />
      </svg>
    </button>
  );
}
