import type { ThinkingEffort } from '@sideboard-ai/core';

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

/** Composer chip that cycles Low → Medium → High → Extra High → Max. */
export function ThinkingEffortChip({ effort, onChange, className }: ChipProps) {
  const label = thinkingEffortLabel(effort);
  return (
    <button
      type="button"
      className={`chip${effort !== 'high' ? ' active effort' : ''}${className ? ` ${className}` : ''}`}
      title={`Thinking effort: ${label} (click to cycle)`}
      onClick={() => onChange(nextThinkingEffort(effort))}
    >
      <ThinkingEffortIcon effort={effort} /> {label}
    </button>
  );
}
