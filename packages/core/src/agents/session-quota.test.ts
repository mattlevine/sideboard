import { describe, expect, it } from 'vitest';
import {
  isSessionQuotaLimit,
  parseSessionQuotaResetAt,
  resolveQuotaFallbackAgent,
} from './session-quota.js';

describe('isSessionQuotaLimit', () => {
  it('matches Claude session limit copy', () => {
    expect(
      isSessionQuotaLimit(
        "You've hit your session limit · resets 7:10pm (America/Los_Angeles)",
      ),
    ).toBe(true);
  });

  it('rejects credits and context overflow', () => {
    expect(isSessionQuotaLimit('Credit balance is too low')).toBe(false);
    expect(isSessionQuotaLimit('Prompt is too long')).toBe(false);
    expect(isSessionQuotaLimit('context window exceeded')).toBe(false);
  });
});

describe('parseSessionQuotaResetAt', () => {
  it('parses absolute reset with timezone', () => {
    // Fixed "now" so the test is stable: before 7:10pm LA on that calendar day.
    const now = new Date('2026-08-09T18:00:00.000Z'); // 11am LA
    const at = parseSessionQuotaResetAt(
      "You've hit your session limit · resets 7:10pm (America/Los_Angeles)",
      now,
    );
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThan(now.getTime());
    // 7:10pm America/Los_Angeles in August is PDT (UTC-7) → 02:10 UTC next calendar day… or 02:10 same UTC day depending.
    // Just assert wall time in zone.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at!);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    expect(hour).toBe('19');
    expect(minute).toBe('10');
  });

  it('parses relative reset', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const at = parseSessionQuotaResetAt('Usage limit — resets in 2 hours', now);
    expect(at?.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
  });
});

describe('resolveQuotaFallbackAgent', () => {
  it('skips the limited agent', () => {
    expect(resolveQuotaFallbackAgent('claude', 'cursor')).toBe('cursor');
    expect(resolveQuotaFallbackAgent('cursor', 'cursor')).toBe('codex');
    expect(resolveQuotaFallbackAgent('claude')).toBe('cursor');
  });
});
