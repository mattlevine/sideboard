import { useRef, useState } from 'react';
import type { ThinkingEffort } from '@sideboard-ai/core';
import { FloatingMenu } from './FloatingMenu';

/**
 * Keep in sync with @sideboard-ai/core ThinkingEffort.
 * Renderer must not import core *values* (pulls Node fs into the bundle).
 */
export const THINKING_EFFORTS: ThinkingEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export function nextThinkingEffort(current: ThinkingEffort): ThinkingEffort {
  const i = THINKING_EFFORTS.indexOf(current);
  return THINKING_EFFORTS[(i + 1) % THINKING_EFFORTS.length]!;
}

/** Conductor-style: 5 rungs; High fills 3. */
export function thinkingEffortBars(effort: ThinkingEffort): number {
  const i = THINKING_EFFORTS.indexOf(effort);
  return i >= 0 ? i + 1 : 3;
}

export function thinkingEffortLabel(effort: ThinkingEffort): string {
  switch (effort) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'Extra High';
    case 'max':
      return 'Max';
    default:
      return 'High';
  }
}

export function parseThinkingEffort(value: unknown): ThinkingEffort {
  if (value === 'normal') return 'medium';
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value;
  }
  return 'high';
}

/** Conductor-style signal bars (5 rungs). */
export function ThinkingEffortIcon({
  effort,
  className = 'chip-effort-bars',
}: {
  effort: ThinkingEffort;
  className?: string;
}) {
  const filled = thinkingEffortBars(effort);
  return (
    <span className={className} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`chip-effort-bar${i <= filled ? ' on' : ''}`}
        />
      ))}
    </span>
  );
}

interface ChipProps {
  effort: ThinkingEffort;
  onChange: (next: ThinkingEffort) => void;
  className?: string;
}

/** Compact chip label (Extra High → Extra) for the send toolbar. */
export function thinkingEffortChipLabel(effort: ThinkingEffort): string {
  return effort === 'xhigh' ? 'Extra' : thinkingEffortLabel(effort);
}

/**
 * Composer chip: click opens a picker so effort can change without the model modal.
 */
export function ThinkingEffortChip({ effort, onChange, className }: ChipProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const label = thinkingEffortChipLabel(effort);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`chip${effort !== 'high' ? ' active effort' : ''}${className ? ` ${className}` : ''}`}
        title={`Thinking effort: ${thinkingEffortLabel(effort)} (click to change)`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <ThinkingEffortIcon effort={effort} /> {label}
      </button>
      <FloatingMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        align="left"
        placement="up"
        minWidth={168}
        className="effort-picker-menu"
      >
        {THINKING_EFFORTS.map((level) => {
          const selected = level === effort;
          return (
            <button
              key={level}
              type="button"
              className={selected ? 'selected' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onChange(level);
                setOpen(false);
              }}
            >
              <span className="menu-item-label">
                <ThinkingEffortIcon effort={level} />
                {thinkingEffortLabel(level)}
              </span>
              {selected ? <span className="effort-picker-check">✓</span> : null}
            </button>
          );
        })}
      </FloatingMenu>
    </>
  );
}
