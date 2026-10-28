import { Cron } from 'croner';

/** 0 = Sunday … 6 = Saturday (cron day-of-week). */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type ScheduleWhen =
  | { kind: 'once'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; expr: string; tz?: string }
  | { kind: 'weekly'; days: number[]; time: string; tz?: string };

const DURATION_RE = /^(\d+)(s|m|h|d)$/i;
const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DAY_ALIASES: Record<string, WeekdayIndex> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function parseDurationMs(every: string): number | null {
  const m = every.trim().match(DURATION_RE);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  return n * UNIT_MS[unit];
}

function dayIndex(token: string): WeekdayIndex | undefined {
  const text = token.trim().toLowerCase();
  if (/^[0-6]$/.test(text)) return Number(text) as WeekdayIndex;
  return DAY_ALIASES[text];
}

export function normalizeWeekdays(days: number[]): WeekdayIndex[] {
  const set = new Set<WeekdayIndex>();
  for (const day of days) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error('Days must be 0 (Sunday) through 6 (Saturday)');
    }
    set.add(day as WeekdayIndex);
  }
  if (set.size === 0) throw new Error('Pick at least one day');
  return [...set].sort((a, b) => a - b);
}

/** `daily`, `weekdays`, `weekends`, `mon,wed,fri`, or `mon-fri`. */
export function parseWeeklyDays(raw: string): WeekdayIndex[] {
  const text = raw.trim().toLowerCase();
  if (!text) throw new Error('Pick at least one day');
  if (text === 'daily' || text === 'all' || text === 'every day' || text === 'everyday') {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  if (text === 'weekdays' || text === 'weekday') return [1, 2, 3, 4, 5];
  if (text === 'weekends' || text === 'weekend') return [0, 6];
  const days: number[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = part.split('-');
    if (range.length === 2 && range[0] && range[1]) {
      const start = dayIndex(range[0]);
      const end = dayIndex(range[1]);
      if (start === undefined || end === undefined) {
        throw new Error(`Unknown day: ${part} (use mon,tue, weekdays, weekends, or daily)`);
      }
      if (start <= end) {
        for (let d = start; d <= end; d++) days.push(d);
      } else {
        for (let d = start; d <= 6; d++) days.push(d);
        for (let d = 0; d <= end; d++) days.push(d);
      }
      continue;
    }
    const n = dayIndex(part);
    if (n === undefined) {
      throw new Error(`Unknown day: ${part} (use mon,tue, weekdays, weekends, or daily)`);
    }
    days.push(n);
  }
  return normalizeWeekdays(days);
}

/** `HH:mm` (24-hour). Seconds from a time input are dropped. */
export function normalizeWeeklyTime(raw: string): string {
  const m = raw.trim().match(TIME_RE);
  if (!m) throw new Error(`Invalid time: ${raw} (use HH:mm, 24-hour)`);
  return `${m[1]}:${m[2]}`;
}

export function formatWeeklyDays(days: number[]): string {
  const key = normalizeWeekdays(days).join(',');
  if (key === '0,1,2,3,4,5,6') return 'daily';
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '0,6') return 'weekends';
  return normalizeWeekdays(days)
    .map((day) => WEEKDAY_LABELS[day])
    .join(', ');
}

/** Cron expression for a clock time on selected days. */
export function weeklyCronExpr(when: { days: number[]; time: string }): string {
  const time = normalizeWeeklyTime(when.time);
  const [hh, mm] = time.split(':');
  const days = normalizeWeekdays(when.days);
  return `${Number(mm)} ${Number(hh)} * * ${days.join(',')}`;
}

export function computeNextRunAt(when: ScheduleWhen, from: Date = new Date()): Date {
  if (when.kind === 'once') {
    const at = new Date(when.at);
    if (Number.isNaN(at.getTime())) {
      throw new Error(`Invalid once-at datetime: ${when.at}`);
    }
    return at;
  }
  if (when.kind === 'every') {
    const ms = parseDurationMs(when.every);
    if (!ms) {
      throw new Error(`Invalid interval: ${when.every} (use 15m, 1h, 6h, 1d)`);
    }
    return new Date(from.getTime() + ms);
  }
  if (when.kind === 'weekly') {
    return computeNextRunAt(
      { kind: 'cron', expr: weeklyCronExpr(when), tz: when.tz },
      from,
    );
  }
  try {
    const job = new Cron(when.expr, {
      timezone: when.tz?.trim() || undefined,
      paused: true,
    });
    const next = job.nextRun(from);
    if (!next) {
      throw new Error(`Cron expression has no next run: ${when.expr}`);
    }
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid cron: ${message}`);
  }
}

export function formatScheduleWhen(when: ScheduleWhen): string {
  if (when.kind === 'once') return `once at ${when.at}`;
  if (when.kind === 'every') return `every ${when.every}`;
  if (when.kind === 'weekly') {
    const label = `${formatWeeklyDays(when.days)} at ${normalizeWeeklyTime(when.time)}`;
    const tz = when.tz?.trim();
    return tz ? `${label} (${tz})` : label;
  }
  const tz = when.tz?.trim();
  return tz ? `cron ${when.expr} (${tz})` : `cron ${when.expr}`;
}

export function normalizeWhen(raw: unknown): ScheduleWhen {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Schedule is missing `when`');
  }
  const rec = raw as Record<string, unknown>;
  const kind = rec.kind;
  if (kind === 'once' && typeof rec.at === 'string') {
    return { kind: 'once', at: rec.at };
  }
  if (kind === 'every' && typeof rec.every === 'string') {
    return { kind: 'every', every: rec.every };
  }
  if (kind === 'cron' && typeof rec.expr === 'string') {
    return {
      kind: 'cron',
      expr: rec.expr,
      tz: typeof rec.tz === 'string' && rec.tz.trim() ? rec.tz.trim() : undefined,
    };
  }
  if (kind === 'weekly' && Array.isArray(rec.days) && typeof rec.time === 'string') {
    return {
      kind: 'weekly',
      days: normalizeWeekdays(rec.days.map((day) => Number(day))),
      time: normalizeWeeklyTime(rec.time),
      tz: typeof rec.tz === 'string' && rec.tz.trim() ? rec.tz.trim() : undefined,
    };
  }
  throw new Error('Schedule `when` must be once, every, weekly, or cron');
}
