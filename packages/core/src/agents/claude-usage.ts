/** Claude Code subscription / plan windows (5-hour, weekly, per-model). */

export type ClaudeUsageWindowId =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet';

export type ClaudeUsageWindow = {
  id: ClaudeUsageWindowId;
  label: string;
  shortLabel: string;
  /** What this window counts against. */
  detail: string;
  /** 0–100 already consumed in this window. */
  usedPercent: number;
  /** 0–100 remaining in this window. */
  remainingPercent: number;
  /** ISO timestamp when the window resets, when known. */
  resetsAt: string | null;
};

export type ClaudeExtraUsage = {
  enabled: boolean;
  usedCredits?: number;
  monthlyLimit?: number;
  usedPercent?: number;
};

export type ClaudePlanUsage = {
  windows: ClaudeUsageWindow[];
  extraUsage?: ClaudeExtraUsage;
  fetchedAt: string;
};

const WINDOW_META: Record<
  ClaudeUsageWindowId,
  { label: string; shortLabel: string; detail: string }
> = {
  five_hour: {
    label: '5-hour session',
    shortLabel: '5h',
    detail: 'Rolling 5-hour limit across all models',
  },
  seven_day: {
    label: 'Weekly',
    shortLabel: 'wk',
    detail: '7-day cap across all models',
  },
  seven_day_opus: {
    label: 'Opus',
    shortLabel: 'Opus',
    detail: 'Weekly Opus-only cap',
  },
  seven_day_sonnet: {
    label: 'Sonnet',
    shortLabel: 'Sonnet',
    detail: 'Weekly Sonnet-only cap',
  },
};

const WINDOW_ORDER: ClaudeUsageWindowId[] = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
];

/** RFC3339 or Unix seconds/ms → ISO, or null. */
export function parseClaudeResetsAt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseClaudeResetsAt(Number(trimmed));
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * Anthropic reports utilization as 0–100. Clamp; ignore non-finite values.
 * Values in (1, 100] stay percents. A bare 0 or 1 is 0% / 1% used (not a ratio).
 */
export function parseClaudeUtilization(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function windowFromRaw(
  id: ClaudeUsageWindowId,
  raw: unknown,
): ClaudeUsageWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { utilization?: unknown; used_percentage?: unknown; resets_at?: unknown };
  const used = parseClaudeUtilization(row.utilization ?? row.used_percentage);
  if (used == null) return null;
  const meta = WINDOW_META[id];
  return {
    id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    detail: meta.detail,
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, 100 - used)),
    resetsAt: parseClaudeResetsAt(row.resets_at),
  };
}

function extraUsageFromRaw(raw: unknown): ClaudeExtraUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as {
    is_enabled?: unknown;
    enabled?: unknown;
    used_credits?: unknown;
    used?: unknown;
    monthly_limit?: unknown;
    utilization?: unknown;
  };
  const enabled = row.is_enabled === true || row.enabled === true;
  if (!enabled && row.is_enabled !== false && row.enabled !== false) return undefined;
  const usedCredits = numberOrUndef(row.used_credits ?? row.used);
  const monthlyLimit = numberOrUndef(row.monthly_limit);
  const usedPercent = parseClaudeUtilization(row.utilization) ?? undefined;
  return {
    enabled,
    ...(usedCredits != null ? { usedCredits } : {}),
    ...(monthlyLimit != null ? { monthlyLimit } : {}),
    ...(usedPercent != null ? { usedPercent } : {}),
  };
}

function numberOrUndef(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/** Map `/api/oauth/usage` JSON (or status-line-shaped rate_limits) → UI snapshot. */
export function parseClaudeUsagePayload(
  raw: unknown,
  fetchedAt: string = new Date().toISOString(),
): ClaudePlanUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const source =
    obj.rate_limits && typeof obj.rate_limits === 'object'
      ? (obj.rate_limits as Record<string, unknown>)
      : obj;
  const windows: ClaudeUsageWindow[] = [];
  for (const id of WINDOW_ORDER) {
    const parsed = windowFromRaw(id, source[id]);
    if (parsed) windows.push(parsed);
  }
  if (windows.length === 0) return null;
  const extra = extraUsageFromRaw(obj.extra_usage ?? source.extra_usage);
  return {
    windows,
    ...(extra ? { extraUsage: extra } : {}),
    fetchedAt,
  };
}

/** Window with the least remaining (most used). */
export function hottestClaudeWindow(
  usage: ClaudePlanUsage,
): ClaudeUsageWindow | null {
  if (usage.windows.length === 0) return null;
  return usage.windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
}

export function formatClaudeUsageReset(
  resetsAt: string | null,
  now: Date = new Date(),
): string {
  if (!resetsAt) return '';
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return '';
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return 'resets soon';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `resets in ${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `resets in ${hours}h`;
  try {
    return `resets ${at.toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  } catch {
    return `resets ${at.toISOString()}`;
  }
}

/** Wall-clock reset, for the hover breakdown next to the relative string. */
export function formatClaudeUsageResetClock(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return at.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return at.toISOString();
  }
}

export function formatClaudeUsageFetchedAt(
  fetchedAt: string,
  now: Date = new Date(),
): string {
  const at = new Date(fetchedAt);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `Updated ${hours}h ago`;
  return `Updated ${formatClaudeUsageResetClock(fetchedAt)}`;
}

export function formatClaudeExtraUsageDetail(extra: ClaudeExtraUsage): string {
  if (!extra.enabled) return 'Extra usage off';
  const bits = ['Extra usage on'];
  if (extra.usedCredits != null && extra.monthlyLimit != null) {
    bits.push(`${extra.usedCredits} / ${extra.monthlyLimit} credits this month`);
  } else if (extra.usedCredits != null) {
    bits.push(`${extra.usedCredits} credits used`);
  }
  if (extra.usedPercent != null) {
    bits.push(`${Math.round(extra.usedPercent)}% of extra pool`);
  }
  return bits.join(' · ');
}

export function formatClaudeUsageWindowLine(
  window: ClaudeUsageWindow,
  now: Date = new Date(),
): string {
  const reset = formatClaudeUsageReset(window.resetsAt, now);
  const clock = formatClaudeUsageResetClock(window.resetsAt);
  const left = `${Math.round(window.remainingPercent)}% left`;
  const used = `${Math.round(window.usedPercent)}% used`;
  const resetBit = reset
    ? clock && !reset.includes(clock)
      ? `${reset} (${clock})`
      : reset
    : '';
  return resetBit
    ? `${window.label} — ${window.detail}. ${left} · ${used} · ${resetBit}`
    : `${window.label} — ${window.detail}. ${left} · ${used}`;
}

/** Accessible breakdown: remaining + used + reset for each plan window. */
export function formatClaudeUsageTooltip(
  usage: ClaudePlanUsage,
  now: Date = new Date(),
): string {
  const lines = [
    'Claude Code plan',
    ...usage.windows.map((w) => formatClaudeUsageWindowLine(w, now)),
  ];
  if (usage.extraUsage) {
    lines.push(formatClaudeExtraUsageDetail(usage.extraUsage));
  }
  const fetched = formatClaudeUsageFetchedAt(usage.fetchedAt, now);
  if (fetched) lines.push(fetched);
  return lines.join('\n');
}

export function formatClaudeUsageCompact(window: ClaudeUsageWindow): string {
  return `${window.shortLabel} ${Math.round(window.remainingPercent)}%`;
}

/** A window is over the plan limit when nothing remains. */
export function claudeUsageWindowOverLimit(window: ClaudeUsageWindow): boolean {
  return window.remainingPercent <= 0 || window.usedPercent >= 100;
}

export function claudeUsageOverLimitWindows(
  usage: ClaudePlanUsage | null | undefined,
): ClaudeUsageWindow[] {
  if (!usage) return [];
  return usage.windows.filter(claudeUsageWindowOverLimit);
}

function formatOverLimitWindowList(
  windows: ClaudeUsageWindow[],
  now: Date,
): { list: string; verb: string } {
  const parts = windows.map((w) => {
    const reset = formatClaudeUsageReset(w.resetsAt, now);
    return reset ? `${w.label} (${reset})` : w.label;
  });
  return {
    list: parts.join(', '),
    verb: windows.length === 1 ? 'is' : 'are',
  };
}

/** Composer confirm copy when Settings → Advanced asks before sending over limit. */
export function formatClaudeUsageOverLimitConfirm(
  windows: ClaudeUsageWindow[],
  now: Date = new Date(),
): string {
  if (windows.length === 0) return '';
  const { list, verb } = formatOverLimitWindowList(windows, now);
  return `Claude Code ${list} ${verb} at or over the plan limit. Send this message anyway?`;
}

/** Composer copy when Settings → Advanced stops send until the window resets. */
export function formatClaudeUsageOverLimitWait(
  windows: ClaudeUsageWindow[],
  now: Date = new Date(),
): string {
  if (windows.length === 0) return '';
  const { list, verb } = formatOverLimitWindowList(windows, now);
  return `Claude Code ${list} ${verb} at or over the plan limit. Sending is paused until the window resets.`;
}
