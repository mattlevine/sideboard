import type { AgentEvent } from '../types/thread.js';

/** At most one full thread JSON parse per thread on this interval. */
export const RECONCILE_HEAL_MIN_MS = 2000;

const SKIP = new Set<AgentEvent['type']>([
  'stdout',
  'thinking',
  'usage',
  'stderr',
  'tool_result',
]);

/**
 * Whether to sync-read the thread record to heal a false
 * "Process died (reconciled on startup)" stamp.
 *
 * Skip high-frequency frames: stdout/thinking (already coalesced, still many),
 * stderr/usage, and tool_result (partial shell tails). tool_use / session_id /
 * exit still check, throttled.
 */
export function shouldReadThreadToHealReconcile(
  eventType: AgentEvent['type'],
  lastCheckAt: number | undefined,
  now: number,
): boolean {
  if (SKIP.has(eventType)) return false;
  if (lastCheckAt != null && now - lastCheckAt < RECONCILE_HEAL_MIN_MS) return false;
  return true;
}
