import { useRef } from 'react';
import type { PointerEvent, KeyboardEvent } from 'react';

interface Props {
  listening: boolean;
  supported: boolean;
  error?: string | null;
  disabled?: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

export function DictationMicButton({
  listening,
  supported,
  error,
  disabled,
  onHoldStart,
  onHoldEnd,
}: Props) {
  const blocked = disabled || !supported;
  const holdingRef = useRef(false);
  const startRef = useRef(onHoldStart);
  const endRef = useRef(onHoldEnd);
  startRef.current = onHoldStart;
  endRef.current = onHoldEnd;

  const title = !supported
    ? 'Dictation is not available'
    : error
      ? error
      : listening
        ? 'Release to stop dictation'
        : 'Hold to dictate';

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (blocked || e.button !== 0) return;
    if (holdingRef.current) return;
    holdingRef.current = true;
    startRef.current();
    e.preventDefault();
    e.stopPropagation();
    const end = () => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      endRef.current();
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (blocked || e.repeat) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (holdingRef.current) return;
    holdingRef.current = true;
    startRef.current();
  }

  function handleKeyUp(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!holdingRef.current) return;
    holdingRef.current = false;
    endRef.current();
  }

  return (
    <button
      type="button"
      className={`icon-round dictation-mic${listening ? ' listening' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={listening}
      disabled={blocked}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
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
