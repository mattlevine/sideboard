import type { TokenUsage } from '../types/thread.js';

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/** Prompt tokens occupying the context window for a single API call. */
export function requestOccupancy(u: TokenUsage): number {
  return u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

/** Accumulate incremental usage (one CLI turn may report usage in several steps). */
export function mergeUsage(a: TokenUsage | null, b: TokenUsage): TokenUsage {
  return {
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
    cacheReadTokens: sumOptional(a?.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: sumOptional(a?.cacheWriteTokens, b.cacheWriteTokens),
    lastRequestTokens: b.lastRequestTokens ?? a?.lastRequestTokens,
  };
}

export type UsageScope = 'request' | 'turn';

/**
 * Fold a usage event into the turn total.
 * Request-scoped events are one API call (sum for billing; last occupancy for the meter).
 * Turn-scoped events replace billed totals (Claude/Codex result) without wiping last-request size.
 */
export function applyTurnUsage(
  current: TokenUsage | null,
  incoming: TokenUsage,
  scope: UsageScope = 'request',
): TokenUsage {
  if (scope === 'turn') {
    return {
      ...incoming,
      lastRequestTokens: current?.lastRequestTokens ?? requestOccupancy(incoming),
    };
  }
  const merged = mergeUsage(current, incoming);
  return { ...merged, lastRequestTokens: requestOccupancy(incoming) };
}

/** Total tokens processed for a turn (input + output + cache reads/writes). */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

/** Context-window fill: last API request when known, else billed input + cache. */
export function contextTokens(u: TokenUsage): number {
  if (u.lastRequestTokens != null && u.lastRequestTokens > 0) return u.lastRequestTokens;
  return requestOccupancy(u);
}
