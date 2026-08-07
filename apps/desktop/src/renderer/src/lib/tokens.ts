import type { TokenUsage } from '@sideboard-ai/core';

/** Total tokens processed for a turn (input + output + cache reads/writes). */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

export function sumUsage(list: (TokenUsage | undefined)[]): TokenUsage | null {
  let total: TokenUsage | null = null;
  for (const u of list) {
    if (!u) continue;
    total = {
      inputTokens: (total?.inputTokens ?? 0) + u.inputTokens,
      outputTokens: (total?.outputTokens ?? 0) + u.outputTokens,
      cacheReadTokens:
        total?.cacheReadTokens != null || u.cacheReadTokens != null
          ? (total?.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0)
          : undefined,
      cacheWriteTokens:
        total?.cacheWriteTokens != null || u.cacheWriteTokens != null
          ? (total?.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0)
          : undefined,
    };
  }
  return total;
}

/** Compact display: 950 -> "950", 1200 -> "1.2k", 1_500_000 -> "1.5M". */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  const m = n / 1_000_000;
  return `${m.toFixed(m >= 100 ? 0 : 1).replace(/\.0$/, '')}M`;
}

export function usageTooltip(u: TokenUsage): string {
  const bits = [`Input: ${u.inputTokens.toLocaleString()}`, `Output: ${u.outputTokens.toLocaleString()}`];
  if (u.cacheReadTokens) bits.push(`Cache read: ${u.cacheReadTokens.toLocaleString()}`);
  if (u.cacheWriteTokens) bits.push(`Cache write: ${u.cacheWriteTokens.toLocaleString()}`);
  return bits.join(' · ');
}
