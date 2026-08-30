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
  let costUsd = 0;
  let any = false;
  let anyCacheRead = false;
  let anyCacheWrite = false;
  let anyCost = false;
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
    if (u.costUsd != null) {
      anyCost = true;
      costUsd += u.costUsd;
    }
  }
  if (!any) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: anyCacheRead ? cacheReadTokens : undefined,
    cacheWriteTokens: anyCacheWrite ? cacheWriteTokens : undefined,
    costUsd: anyCost ? costUsd : undefined,
  };
}

/** Compact USD display: $0.0012 below 1¢, $1.23 otherwise. */
export function formatCostUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${n.toFixed(2)}`;
}

/** ` · $X` when showCost is on and costUsd is present; otherwise empty. */
export function formatCostSuffix(
  costUsd: number | undefined | null,
  showCost: boolean,
): string {
  if (!showCost || costUsd == null) return '';
  return ` · ${formatCostUsd(costUsd)}`;
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

export function usageTooltip(
  u: TokenUsage,
  opts?: { showCost?: boolean },
): string {
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
  if (opts?.showCost && u.costUsd != null) bits.push(`Cost ${formatCostUsd(u.costUsd)}`);
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

/**
 * Occupancy that can fill the 1M ring. Values over the window are billed-turn
 * leaks (summed tool rounds), not next-request size — do not paint a full ring.
 */
export function meterOccupancyTokens(
  usage: TokenUsage,
  windowTokens: number,
): number | null {
  if (windowTokens <= 0) return null;
  const occ = contextTokens(usage);
  if (occ <= 0 || occ > windowTokens) return null;
  return occ;
}

export function occupancyFillRatio(
  occupancy: number,
  windowTokens: number,
): number {
  if (windowTokens <= 0 || occupancy <= 0) return 0;
  return Math.min(1, occupancy / windowTokens);
}

export function contextFillRatio(
  usage: TokenUsage,
  windowTokens: number,
): number {
  const occ = meterOccupancyTokens(usage, windowTokens);
  if (occ == null) return 0;
  return occupancyFillRatio(occ, windowTokens);
}

/** Warn/hot from occupancy fill — never from billed thread totals. */
export function contextMeterTone(ratio: number): '' | 'warn' | 'hot' {
  if (!Number.isFinite(ratio) || ratio <= 0) return '';
  if (ratio >= 0.85) return 'hot';
  if (ratio >= 0.65) return 'warn';
  return '';
}

export function contextMeterTooltip(
  usage: TokenUsage | null,
  windowTokens: number,
  opts?: { compacted?: boolean; billedTotal?: number; occupancy?: number },
): string {
  const occ =
    opts?.occupancy != null && opts.occupancy > 0
      ? opts.occupancy
      : usage
        ? meterOccupancyTokens(usage, windowTokens)
        : null;
  const used = occ ?? (usage ? contextTokens(usage) : 0);
  const pct = Math.round(occupancyFillRatio(occ ?? 0, windowTokens) * 100);
  const basis = opts?.compacted
    ? 'remaining after compression'
    : occ == null
      ? 'billed turn total (occupancy unknown)'
      : 'next request (going-forward context)';
  const bits = [
    occ == null
      ? usage
        ? `Billed ${formatTokenCount(totalTokens(usage))} — occupancy over ${formatTokenCount(windowTokens)} or missing`
        : `Context / ${formatTokenCount(windowTokens)}`
      : `Context ~${formatTokenCount(used)} / ${formatTokenCount(windowTokens)} (${pct}%) — ${basis}`,
  ];
  if (opts?.billedTotal != null && opts.billedTotal > 0) {
    bits.push(`Thread billed Σ ${formatTokenCount(opts.billedTotal)}`);
  }
  return bits.join(' · ');
}

/** Occupancy / window for tooltips and the agent-message chip. */
export function contextOccupancyLabel(usage: TokenUsage, windowTokens: number): string {
  return `${formatTokenCount(contextTokens(usage))} / ${formatTokenCount(windowTokens)}`;
}

/** Billed total string shared by the worktree hover card. */
export function billedUsageLabel(usage: TokenUsage, showCost: boolean): string {
  return `${formatTokenCount(totalTokens(usage))} tok${formatCostSuffix(usage.costUsd, showCost)}`;
}

/** Tabs-bar label: going-forward occupancy / fixed window. Never billed Σ. */
export function tabsContextLabel(
  occupancy: number,
  windowTokens: number,
  costUsd?: number | null,
  showCost = false,
): string {
  return `${formatTokenCount(Math.max(0, occupancy))} / ${formatTokenCount(windowTokens)}${formatCostSuffix(costUsd, showCost)}`;
}
