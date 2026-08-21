import { describe, expect, it } from 'vitest';
import { contextFillRatio, contextTokens, formatTokenCount, resolveContextWindow, totalTokens, usageTooltip } from './tokens';

describe('contextTokens', () => {
  it('prefers last-request occupancy over billed turn totals', () => {
    expect(
      contextTokens({
        inputTokens: 10_000,
        outputTokens: 200,
        cacheReadTokens: 200_000,
        lastRequestTokens: 80_500,
      }),
    ).toBe(80_500);
  });

  it('falls back to input + cache when last-request size is unknown', () => {
    expect(
      contextTokens({
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 900,
        cacheWriteTokens: 300,
      }),
    ).toBe(1_320);
  });
});

describe('contextFillRatio', () => {
  it('fills against the last request, not the billed sum', () => {
    const usage = {
      inputTokens: 50_000,
      outputTokens: 100,
      cacheReadTokens: 400_000,
      lastRequestTokens: 90_000,
    };
    expect(contextFillRatio(usage, 200_000)).toBeCloseTo(0.45);
  });
});

describe('resolveContextWindow', () => {
  it('assumes 1M for every agent and model', () => {
    expect(resolveContextWindow('claude', 'haiku', 80_000)).toBe(1_000_000);
    expect(resolveContextWindow('cursor', 'composer-2.5', 80_000)).toBe(1_000_000);
    expect(resolveContextWindow('brightsy', null, 80_000)).toBe(1_000_000);
    expect(
      contextFillRatio(
        { inputTokens: 346_000, outputTokens: 10, lastRequestTokens: 346_000 },
        resolveContextWindow('cursor', 'default', 346_000),
      ),
    ).toBeCloseTo(0.346);
  });
});

describe('message chip vs billed total', () => {
  it('does not show cache-summed billed tokens as the chip (Slack hi / tool rounds)', () => {
    const usage = {
      inputTokens: 12_000,
      outputTokens: 800,
      cacheReadTokens: 80_000,
      cacheWriteTokens: 82_000,
      lastRequestTokens: 94_000,
    };
    expect(totalTokens(usage)).toBe(174_800);
    expect(contextTokens(usage)).toBe(94_000);
    expect(formatTokenCount(contextTokens(usage))).toBe('94k');
    expect(formatTokenCount(totalTokens(usage))).toBe('175k');
    expect(usageTooltip(usage)).toContain('Context ~94,000');
    expect(usageTooltip(usage)).toContain('Billed 174,800');
  });
});
