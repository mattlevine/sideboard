import { describe, expect, it } from 'vitest';
import {
  claudeUsageOverLimitWindows,
  formatClaudeExtraUsageDetail,
  formatClaudeUsageCompact,
  formatClaudeUsageFetchedAt,
  formatClaudeUsageOverLimitConfirm,
  formatClaudeUsageReset,
  formatClaudeUsageResetClock,
  formatClaudeUsageTooltip,
  hottestClaudeWindow,
  parseClaudeResetsAt,
  parseClaudeUsagePayload,
  parseClaudeUtilization,
} from './claude-usage.js';

describe('parseClaudeUtilization', () => {
  it('clamps 0–100 percents', () => {
    expect(parseClaudeUtilization(6)).toBe(6);
    expect(parseClaudeUtilization(0)).toBe(0);
    expect(parseClaudeUtilization(100)).toBe(100);
    expect(parseClaudeUtilization(140)).toBe(100);
    expect(parseClaudeUtilization(-2)).toBe(0);
  });

  it('rejects non-finite values', () => {
    expect(parseClaudeUtilization(undefined)).toBeNull();
    expect(parseClaudeUtilization('42')).toBeNull();
    expect(parseClaudeUtilization(Number.NaN)).toBeNull();
  });
});

describe('parseClaudeResetsAt', () => {
  it('accepts ISO strings', () => {
    expect(parseClaudeResetsAt('2026-04-08T18:59:59Z')).toBe(
      '2026-04-08T18:59:59.000Z',
    );
  });

  it('accepts Unix seconds and milliseconds', () => {
    expect(parseClaudeResetsAt(1_786_641_000)).toBe('2026-08-13T17:10:00.000Z');
    expect(parseClaudeResetsAt(1_786_641_000_000)).toBe('2026-08-13T17:10:00.000Z');
  });
});

describe('parseClaudeUsagePayload', () => {
  it('maps oauth/usage buckets including per-model windows', () => {
    const usage = parseClaudeUsagePayload(
      {
        five_hour: { utilization: 32, resets_at: '2026-04-08T18:59:59Z' },
        seven_day: { utilization: 59, resets_at: '2026-04-14T16:59:59Z' },
        seven_day_opus: { utilization: 12, resets_at: '2026-04-14T17:59:59Z' },
        seven_day_sonnet: null,
        extra_usage: { is_enabled: true, used_credits: 4, monthly_limit: 100 },
      },
      '2026-04-08T12:00:00.000Z',
    );
    expect(usage?.windows).toEqual([
      {
        id: 'five_hour',
        label: '5-hour session',
        shortLabel: '5h',
        detail: 'Rolling 5-hour limit across all models',
        usedPercent: 32,
        remainingPercent: 68,
        resetsAt: '2026-04-08T18:59:59.000Z',
      },
      {
        id: 'seven_day',
        label: 'Weekly',
        shortLabel: 'wk',
        detail: '7-day cap across all models',
        usedPercent: 59,
        remainingPercent: 41,
        resetsAt: '2026-04-14T16:59:59.000Z',
      },
      {
        id: 'seven_day_opus',
        label: 'Opus',
        shortLabel: 'Opus',
        detail: 'Weekly Opus-only cap',
        usedPercent: 12,
        remainingPercent: 88,
        resetsAt: '2026-04-14T17:59:59.000Z',
      },
    ]);
    expect(usage?.extraUsage).toEqual({
      enabled: true,
      usedCredits: 4,
      monthlyLimit: 100,
    });
  });

  it('accepts status-line used_percentage + nested rate_limits', () => {
    const usage = parseClaudeUsagePayload({
      rate_limits: {
        five_hour: { used_percentage: 83, resets_at: 1_786_641_000 },
        seven_day: { used_percentage: 76, resets_at: 1_786_809_600 },
      },
    });
    expect(usage?.windows.map((w) => w.id)).toEqual(['five_hour', 'seven_day']);
    expect(usage?.windows[0]?.usedPercent).toBe(83);
    expect(usage?.windows[0]?.remainingPercent).toBe(17);
  });

  it('returns null when no plan windows are present (API key mode)', () => {
    expect(parseClaudeUsagePayload({ extra_usage: { is_enabled: false } })).toBeNull();
    expect(parseClaudeUsagePayload({})).toBeNull();
    expect(parseClaudeUsagePayload(null)).toBeNull();
  });
});

describe('hottestClaudeWindow', () => {
  it('picks the most used window', () => {
    const usage = parseClaudeUsagePayload({
      five_hour: { utilization: 20 },
      seven_day: { utilization: 80 },
      seven_day_opus: { utilization: 10 },
    });
    expect(hottestClaudeWindow(usage!)?.id).toBe('seven_day');
  });
});

describe('formatClaudeUsage*', () => {
  const usage = parseClaudeUsagePayload(
    {
      five_hour: { utilization: 32, resets_at: '2026-04-08T18:00:00Z' },
      seven_day: { utilization: 59, resets_at: '2026-04-14T16:00:00Z' },
    },
    '2026-04-08T12:00:00.000Z',
  )!;

  it('formats remaining compact labels', () => {
    expect(formatClaudeUsageCompact(usage.windows[0]!)).toBe('5h 68%');
    expect(formatClaudeUsageCompact(usage.windows[1]!)).toBe('wk 41%');
  });

  it('formats relative reset when under 36h', () => {
    expect(
      formatClaudeUsageReset('2026-04-08T18:00:00Z', new Date('2026-04-08T12:00:00Z')),
    ).toBe('resets in 6h');
    expect(
      formatClaudeUsageReset('2026-04-08T12:20:00Z', new Date('2026-04-08T12:00:00Z')),
    ).toBe('resets in 20m');
  });

  it('builds a remaining-first breakdown with window detail and reset clock', () => {
    const tip = formatClaudeUsageTooltip(
      usage,
      new Date('2026-04-08T12:00:00Z'),
    );
    expect(tip).toContain('Claude Code plan');
    expect(tip).toContain('5-hour session — Rolling 5-hour limit across all models');
    expect(tip).toContain('68% left · 32% used · resets in 6h');
    expect(tip).toContain('Weekly — 7-day cap across all models');
    expect(tip).toContain('Updated just now');
  });

  it('formats extra usage and fetch age', () => {
    expect(
      formatClaudeExtraUsageDetail({
        enabled: true,
        usedCredits: 4,
        monthlyLimit: 100,
        usedPercent: 4,
      }),
    ).toBe('Extra usage on · 4 / 100 credits this month · 4% of extra pool');
    expect(
      formatClaudeUsageFetchedAt(
        '2026-04-08T11:40:00.000Z',
        new Date('2026-04-08T12:00:00Z'),
      ),
    ).toBe('Updated 20m ago');
    expect(formatClaudeUsageResetClock('2026-04-08T18:00:00Z').length).toBeGreaterThan(6);
  });
});

describe('claudeUsageOverLimitWindows', () => {
  it('returns only exhausted windows', () => {
    const usage = parseClaudeUsagePayload({
      five_hour: { utilization: 100, resets_at: '2026-04-08T18:00:00Z' },
      seven_day: { utilization: 59, resets_at: '2026-04-14T16:00:00Z' },
      seven_day_opus: { utilization: 100 },
    });
    const over = claudeUsageOverLimitWindows(usage);
    expect(over.map((w) => w.id)).toEqual(['five_hour', 'seven_day_opus']);
    expect(
      formatClaudeUsageOverLimitConfirm(over, new Date('2026-04-08T12:00:00Z')),
    ).toBe(
      'Claude Code 5-hour session (resets in 6h), Opus are at or over the plan limit. Send this message anyway?',
    );
  });

  it('is empty when every window has remaining quota', () => {
    const usage = parseClaudeUsagePayload({
      five_hour: { utilization: 99 },
      seven_day: { utilization: 1 },
    });
    expect(claudeUsageOverLimitWindows(usage)).toEqual([]);
    expect(claudeUsageOverLimitWindows(null)).toEqual([]);
  });
});
