import type { AgentKind, TokenUsage } from '@sideboard-ai/core';

/** Assumed context window for every agent/model (meter fill = occupancy / this). */
export const CONTEXT_WINDOW_TOKENS = 1_000_000;

/** Total tokens processed for a turn (uncached input + output + cache reads/writes). */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

/**
 * Approximate tokens occupying the context window for a turn.
 * Prefers last-request occupancy (one API call) over billed input+cache summed
 * across every tool round in the turn.
 */
export function contextTokens(u: TokenUsage): number {
  if (u.lastRequestTokens != null && u.lastRequestTokens > 0) return u.lastRequestTokens;
  return u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

export function sumUsage(list: (TokenUsage | undefined)[]): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let any = false;
  let anyCacheRead = false;
  let anyCacheWrite = false;
  for (const u of list) {
    if (!u) continue;
    any = true;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    if (u.cacheReadTokens != null) {
      anyCacheRead = true;
      cacheReadTokens += u.cacheReadTokens;
    }
    if (u.cacheWriteTokens != null) {
      anyCacheWrite = true;
      cacheWriteTokens += u.cacheWriteTokens;
    }
  }
  if (!any) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: anyCacheRead ? cacheReadTokens : undefined,
    cacheWriteTokens: anyCacheWrite ? cacheWriteTokens : undefined,
  };
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
  const billed = totalTokens(u);
  const context = contextTokens(u);
  const bits = [
    `Context ~${context.toLocaleString()}`,
    `Billed ${billed.toLocaleString()}`,
    `Input: ${u.inputTokens.toLocaleString()}`,
    `Output: ${u.outputTokens.toLocaleString()}`,
  ];
  if (u.cacheReadTokens) bits.push(`Cache read: ${u.cacheReadTokens.toLocaleString()}`);
  if (u.cacheWriteTokens) bits.push(`Cache write: ${u.cacheWriteTokens.toLocaleString()}`);
  return bits.join(' · ');
}

/** Every agent is treated as a 1M window. Args kept so call sites stay stable. */
export function estimateContextWindow(
  _agent?: AgentKind,
  _model?: string | null,
): number {
  return CONTEXT_WINDOW_TOKENS;
}

export function resolveContextWindow(
  _agent?: AgentKind,
  _model?: string | null,
  _occupancyTokens?: number,
): number {
  return CONTEXT_WINDOW_TOKENS;
}

export function contextFillRatio(
  usage: TokenUsage,
  windowTokens: number,
): number {
  if (windowTokens <= 0) return 0;
  return Math.min(1, contextTokens(usage) / windowTokens);
}

export function contextMeterTooltip(
  usage: TokenUsage,
  windowTokens: number,
): string {
  const used = contextTokens(usage);
  const pct = Math.round(contextFillRatio(usage, windowTokens) * 100);
  return `Context ~${formatTokenCount(used)} / ${formatTokenCount(windowTokens)} (${pct}%) — last request input + cache`;
}
