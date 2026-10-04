import type { TokenUsage } from '../types/thread.js';

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * OpenAI/Codex/Brightsy-shaped usage → Claude-shaped {@link TokenUsage}.
 * `cachedInputTokens` is already inside `inputTokens`; reasoning is already
 * inside `outputTokens` when the provider reports it separately.
 */
export function fromInclusiveInputUsage(opts: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): TokenUsage | null {
  const totalInput = Number(opts.inputTokens) || 0;
  const outputTokens = Number(opts.outputTokens) || 0;
  const cached = Number(opts.cachedInputTokens) || 0;
  if (!totalInput && !outputTokens) return null;
  const cacheReadTokens = cached > 0 ? Math.min(cached, totalInput) : 0;
  return {
    inputTokens: Math.max(0, totalInput - cacheReadTokens),
    outputTokens,
    cacheReadTokens: cacheReadTokens || undefined,
  };
}

/** Prompt tokens occupying the context window for a single API call. */
export function requestOccupancy(u: TokenUsage): number {
  // Assumes Claude-shaped usage: inputTokens is uncached; cache hits are extra.
  return u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

/** Accumulate incremental usage (one CLI turn may report usage in several steps). */
export function mergeUsage(a: TokenUsage | null, b: TokenUsage): TokenUsage {
  return {
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
    cacheReadTokens: sumOptional(a?.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: sumOptional(a?.cacheWriteTokens, b.cacheWriteTokens),
    costUsd: sumOptional(a?.costUsd, b.costUsd),
    sessionCostUsd: b.sessionCostUsd ?? a?.sessionCostUsd,
    lastRequestTokens: b.lastRequestTokens ?? a?.lastRequestTokens,
  };
}

/**
 * Sum billed usage across turns (thread total). Omits `lastRequestTokens`
 * (that field is per-request occupancy, not additive).
 */
export function sumUsageList(list: (TokenUsage | undefined | null)[]): TokenUsage | null {
  let acc: TokenUsage | null = null;
  for (const u of list) {
    if (!u) continue;
    acc = mergeUsage(acc, {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costUsd: u.costUsd,
    });
  }
  if (!acc) return null;
  return {
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    ...(acc.cacheReadTokens != null ? { cacheReadTokens: acc.cacheReadTokens } : {}),
    ...(acc.cacheWriteTokens != null ? { cacheWriteTokens: acc.cacheWriteTokens } : {}),
    ...(acc.costUsd != null ? { costUsd: acc.costUsd } : {}),
  };
}

export type UsageScope = 'request' | 'turn';

/**
 * Fold a usage event into the turn total.
 * Request-scoped events are one API call (sum for billing; last occupancy for the meter).
 * Turn-scoped events replace billed totals (Claude/Codex result) without wiping last-request size.
 */
function hasBilledTokens(u: TokenUsage): boolean {
  return Boolean(
    u.inputTokens ||
      u.outputTokens ||
      u.cacheReadTokens ||
      u.cacheWriteTokens,
  );
}

export function applyTurnUsage(
  current: TokenUsage | null,
  incoming: TokenUsage,
  scope: UsageScope = 'request',
): TokenUsage {
  if (scope === 'turn') {
    // Cost-only turn updates (e.g. Cursor getUsage after stream tokens) must not
    // wipe billed tokens or last-request occupancy.
    if (!hasBilledTokens(incoming) && current && incoming.costUsd != null) {
      return {
        ...current,
        costUsd: incoming.costUsd,
        ...(incoming.sessionCostUsd != null
          ? { sessionCostUsd: incoming.sessionCostUsd }
          : {}),
      };
    }
    return {
      ...incoming,
      costUsd: incoming.costUsd ?? current?.costUsd,
      lastRequestTokens: current?.lastRequestTokens ?? requestOccupancy(incoming),
      ...(incoming.sessionCostUsd == null && current?.sessionCostUsd != null
        ? { sessionCostUsd: current.sessionCostUsd }
        : {}),
    };
  }
  const merged = mergeUsage(current, incoming);
  const occ =
    incoming.lastRequestTokens != null && incoming.lastRequestTokens > 0
      ? incoming.lastRequestTokens
      : requestOccupancy(incoming);
  return {
    ...merged,
    lastRequestTokens: occ > 0 ? occ : (current?.lastRequestTokens ?? occ),
  };
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

const USD_EPS = 1e-6;

function finiteUsd(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return n;
}

function roundUsd(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function approxEqualUsd(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(USD_EPS, Math.abs(a) * 1e-6, Math.abs(b) * 1e-6);
}

type UsageCostMessage = { role?: string; usage?: TokenUsage | null };

/**
 * Prior session spend from earlier agent messages.
 * Prefer the last `sessionCostUsd`; otherwise sum turn-scoped `costUsd`.
 */
export function previousCostBaseline(
  messages: ReadonlyArray<UsageCostMessage>,
): { sessionCostUsd: number; lastCostUsd: number | undefined } {
  let summed = 0;
  let lastCost: number | undefined;
  let lastSession: number | undefined;
  for (const m of messages) {
    if (m.role !== 'agent' || !m.usage) continue;
    const session = finiteUsd(m.usage.sessionCostUsd);
    if (session != null) lastSession = session;
    const cost = finiteUsd(m.usage.costUsd);
    if (cost != null) {
      summed += cost;
      lastCost = cost;
    }
  }
  return {
    sessionCostUsd: lastSession ?? summed,
    lastCostUsd: lastCost,
  };
}

/**
 * Turn-scoped USD from a provider snapshot that may be session-cumulative
 * (Claude `total_cost_usd` after `--resume`).
 */
export function turnCostUsdFromProviderSnapshot(opts: {
  reportedTurnCostUsd?: number;
  sessionCostUsd?: number;
  previousSessionCostUsd: number;
  previousLastCostUsd?: number;
}): number | undefined {
  const reported = finiteUsd(opts.reportedTurnCostUsd);
  const session = finiteUsd(opts.sessionCostUsd);
  const previous = Math.max(0, opts.previousSessionCostUsd || 0);
  const last = finiteUsd(opts.previousLastCostUsd);

  if (session != null) {
    const looksLikeSessionTotal =
      reported == null || approxEqualUsd(reported, session);
    if (looksLikeSessionTotal) {
      if (session + USD_EPS >= previous) {
        return roundUsd(Math.max(0, session - previous));
      }
      if (last != null && session + USD_EPS >= last) {
        return roundUsd(Math.max(0, session - last));
      }
      return undefined;
    }
  }

  return reported;
}

/**
 * Rewrite `costUsd` so it is this turn when the provider only gave a session total.
 * Keeps `sessionCostUsd` as the raw cumulative snapshot.
 */
export function withTurnScopedCost(
  usage: TokenUsage,
  previousMessages: ReadonlyArray<UsageCostMessage>,
): TokenUsage {
  const baseline = previousCostBaseline(previousMessages);
  const costUsd = turnCostUsdFromProviderSnapshot({
    reportedTurnCostUsd: usage.costUsd,
    sessionCostUsd: usage.sessionCostUsd,
    previousSessionCostUsd: baseline.sessionCostUsd,
    previousLastCostUsd: baseline.lastCostUsd,
  });
  if (costUsd == null) {
    if (usage.costUsd == null) return usage;
    const next = { ...usage };
    delete next.costUsd;
    return next;
  }
  if (usage.costUsd === costUsd) return usage;
  return { ...usage, costUsd };
}
