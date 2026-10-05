import type { MouseEvent } from 'react';

interface Props {
  listening: boolean;
  supported: boolean;
  error?: string | null;
  disabled?: boolean;
  onToggle: () => void;
}

export function DictationMicButton({
  listening,
  supported,
  error,
  disabled,
  onToggle,
}: Props) {
  const title = !supported
    ? 'Dictation is not available'
    : error
      ? error
      : listening
        ? 'Stop dictation'
        : 'Dictate';

  function handleMouseDown(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
  }

  return (
    <button
      type="button"
      className={`icon-round dictation-mic${listening ? ' listening' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={listening}
      disabled={disabled}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
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
