/**
 * Agent thinking / reasoning effort.
 * Matches Claude Code `--effort` and Conductor's 5-rung effort chip:
 * low → medium → high → xhigh → max.
 */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const THINKING_EFFORTS: ThinkingEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const EFFORT_SET = new Set<string>(THINKING_EFFORTS);

/** Conductor settings sometimes use `normal` for the mid Claude effort band. */
export function normalizeThinkingEffort(value: unknown): ThinkingEffort | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'normal') return 'medium';
  if (EFFORT_SET.has(v)) return v as ThinkingEffort;
  return null;
}

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === 'string' && EFFORT_SET.has(value.trim().toLowerCase());
}

/** Cycle Low → … → Max → Low (Conductor ⌥T-style). */
export function nextThinkingEffort(current: ThinkingEffort): ThinkingEffort {
  const i = THINKING_EFFORTS.indexOf(current);
  return THINKING_EFFORTS[(i + 1) % THINKING_EFFORTS.length]!;
}

/** How many of 5 Conductor-style signal bars are filled. */
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
  }
}
