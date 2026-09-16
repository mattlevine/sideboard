import { describe, expect, it } from 'vitest';
import { isUsageOnLimit, resolveUsageOnLimit } from './usage-on-limit.js';

describe('isUsageOnLimit', () => {
  it('accepts the four policy values', () => {
    expect(isUsageOnLimit('keep_going')).toBe(true);
    expect(isUsageOnLimit('confirm')).toBe(true);
    expect(isUsageOnLimit('switch_agent')).toBe(true);
    expect(isUsageOnLimit('wait_reset')).toBe(true);
    expect(isUsageOnLimit('switch')).toBe(false);
    expect(isUsageOnLimit(true)).toBe(false);
  });
});

describe('resolveUsageOnLimit', () => {
  it('defaults to keep going', () => {
    expect(resolveUsageOnLimit({})).toBe('keep_going');
  });

  it('prefers the unified field over legacy flags', () => {
    expect(
      resolveUsageOnLimit({
        usageOnLimit: 'keep_going',
        confirmClaudeUsageOverLimit: true,
        orchestrationQuotaOnLimit: 'switch_agent',
      }),
    ).toBe('keep_going');
  });

  it('migrates legacy confirm and orchestration quota fields', () => {
    expect(resolveUsageOnLimit({ confirmClaudeUsageOverLimit: true })).toBe('confirm');
    expect(resolveUsageOnLimit({ orchestrationQuotaOnLimit: 'wait_reset' })).toBe(
      'wait_reset',
    );
    expect(resolveUsageOnLimit({ orchestrationQuotaOnLimit: 'switch_agent' })).toBe(
      'switch_agent',
    );
  });
});
