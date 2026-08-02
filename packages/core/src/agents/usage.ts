import type { TokenUsage } from '../types/thread.js';

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/** Accumulate incremental usage (one CLI turn may report usage in several steps). */
export function mergeUsage(a: TokenUsage | null, b: TokenUsage): TokenUsage {
  return {
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
    cacheReadTokens: sumOptional(a?.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: sumOptional(a?.cacheWriteTokens, b.cacheWriteTokens),
  };
}

/** Total tokens processed for a turn (input + output + cache reads/writes). */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}
