/**
 * Settings → Advanced — what to do when a Claude plan window is exhausted
 * or a turn hits a provider session/usage limit. Node-free so the desktop
 * renderer can import it via `@sideboard/usage-on-limit`.
 *
 * - `keep_going` (default): do not interrupt
 * - `confirm`: ask before composer send
 * - `switch_agent`: continue on the configured fallback agent
 * - `wait_reset`: stop sending until the window resets, then retry
 */
export type UsageOnLimit = 'keep_going' | 'confirm' | 'switch_agent' | 'wait_reset';

export const USAGE_ON_LIMIT_VALUES = [
  'keep_going',
  'confirm',
  'switch_agent',
  'wait_reset',
] as const;

export function isUsageOnLimit(value: unknown): value is UsageOnLimit {
  return (
    value === 'keep_going' ||
    value === 'confirm' ||
    value === 'switch_agent' ||
    value === 'wait_reset'
  );
}

/** Resolve the unified policy, including legacy Advanced fields. */
export function resolveUsageOnLimit(
  advanced: {
    usageOnLimit?: unknown;
    confirmClaudeUsageOverLimit?: boolean;
    orchestrationQuotaOnLimit?: string;
  } = {},
): UsageOnLimit {
  if (isUsageOnLimit(advanced.usageOnLimit)) return advanced.usageOnLimit;
  if (advanced.confirmClaudeUsageOverLimit) return 'confirm';
  if (advanced.orchestrationQuotaOnLimit === 'wait_reset') return 'wait_reset';
  if (advanced.orchestrationQuotaOnLimit === 'switch_agent') return 'switch_agent';
  return 'keep_going';
}
