import type { AgentKind, TokenUsage } from '@sideboard-ai/core';

/** Total tokens processed for a turn (input + output + cache reads/writes). */
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
  const bits = [`Input: ${u.inputTokens.toLocaleString()}`, `Output: ${u.outputTokens.toLocaleString()}`];
  if (u.cacheReadTokens) bits.push(`Cache read: ${u.cacheReadTokens.toLocaleString()}`);
  if (u.cacheWriteTokens) bits.push(`Cache write: ${u.cacheWriteTokens.toLocaleString()}`);
  return bits.join(' · ');
}

/** Best-effort context window size when the agent does not report one. */
export function estimateContextWindow(
  agent: AgentKind,
  model?: string | null,
): number {
  const m = (model ?? '').trim().toLowerCase();
  if (
    m.includes('1m') ||
    m.includes('1000000') ||
    m.includes('fable') ||
    m.includes('opus-4-6') ||
    m.includes('opus-4.6')
  ) {
    return 1_000_000;
  }
  if (agent === 'claude') return 200_000;
  if (agent === 'cursor') return 200_000;
  if (agent === 'codex') return 200_000;
  if (agent === 'opencode') return 200_000;
  if (agent === 'brightsy') return 128_000;
  return 200_000;
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
