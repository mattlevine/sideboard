import type { AgentKind } from '../types/thread.js';

/**
 * Provider session/usage quota (Claude “session limit”, weekly/opus caps, etc.).
 * Not context-window overflow and not billing/credits.
 */
export function isSessionQuotaLimit(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  if (/credit balance is too low|out of credits|insufficient.?quota|billing/.test(lower)) {
    return false;
  }
  if (/prompt is too long|context.*(too long|exceed)|conversation too long/.test(lower)) {
    return false;
  }
  return (
    /you've hit your/.test(lower) ||
    /hit your (session|weekly|opus) limit/.test(lower) ||
    /usage limit/.test(lower) ||
    (/rate.?limit|too many requests|\b429\b/.test(lower) && /reset/i.test(text))
  );
}

/** Best-effort parse of “resets 7:10pm (America/Los_Angeles)” / “resets in 2 hours”. */
export function parseSessionQuotaResetAt(
  text: string,
  now: Date = new Date(),
): Date | null {
  const absolute = text.match(
    /resets\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)(?:\s*\(([^)]+)\))?/i,
  );
  if (absolute) {
    const hour12 = Number(absolute[1]);
    const minute = Number(absolute[2]);
    const ampm = absolute[3]!.toLowerCase();
    const timeZone = absolute[4]?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let hour = hour12 % 12;
    if (ampm === 'pm') hour += 12;
    const at = zonedWallTimeToUtc(now, hour, minute, timeZone);
    if (!at) return null;
    // If that clock time already passed today (in-zone), use tomorrow.
    if (at.getTime() <= now.getTime() + 30_000) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      return zonedWallTimeToUtc(tomorrow, hour, minute, timeZone);
    }
    return at;
  }

  const relative = text.match(
    /resets\s+in\s+(\d+)\s*(minutes?|hours?|days?)/i,
  );
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const ms =
      unit.startsWith('day')
        ? n * 24 * 60 * 60 * 1000
        : unit.startsWith('hour')
          ? n * 60 * 60 * 1000
          : n * 60 * 1000;
    return new Date(now.getTime() + ms);
  }

  return null;
}

/**
 * Convert a wall-clock hour:minute on the calendar day of `day` in `timeZone` to UTC.
 * Uses Intl offset probing (no extra deps).
 */
function zonedWallTimeToUtc(
  day: Date,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  try {
    const cal = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(
      cal
        .formatToParts(day)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    ) as { year: string; month: string; day: string };
    const year = Number(parts.year);
    const month = Number(parts.month);
    const date = Number(parts.day);
    if (![year, month, date].every((n) => Number.isFinite(n))) return null;

    const utcGuess = Date.UTC(year, month - 1, date, hour, minute, 0);
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const asParts = Object.fromEntries(
      dtf
        .formatToParts(new Date(utcGuess))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asUtc = Date.UTC(
      Number(asParts.year),
      Number(asParts.month) - 1,
      Number(asParts.day),
      Number(asParts.hour),
      Number(asParts.minute),
      Number(asParts.second || '0'),
    );
    const offset = asUtc - utcGuess;
    return new Date(utcGuess - offset);
  } catch {
    return null;
  }
}

const FALLBACK_ORDER: AgentKind[] = [
  'cursor',
  'codex',
  'opencode',
  'brightsy',
  'claude',
];

/** Pick a different agent for quota failover (preferred first, then stable order). */
export function resolveQuotaFallbackAgent(
  current: AgentKind,
  preferred?: AgentKind | null,
): AgentKind {
  const ordered = preferred
    ? [preferred, ...FALLBACK_ORDER.filter((a) => a !== preferred)]
    : FALLBACK_ORDER;
  return ordered.find((a) => a !== current) ?? (current === 'cursor' ? 'codex' : 'cursor');
}
