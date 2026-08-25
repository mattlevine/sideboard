import { describe, expect, it } from 'vitest';
import { contextFillRatio, contextTokens, formatCostSuffix, formatCostUsd, formatTokenCount, resolveContextWindow, sumUsage, totalTokens, usageTooltip } from './tokens';

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

describe('formatCostUsd', () => {
  it('shows four decimals below one cent', () => {
    expect(formatCostUsd(0.0012)).toBe('$0.0012');
    expect(formatCostUsd(0.001)).toBe('$0.001');
  });

  it('shows two decimals at or above one cent', () => {
    expect(formatCostUsd(0.01)).toBe('$0.01');
    expect(formatCostUsd(1.234)).toBe('$1.23');
  });
});

describe('sumUsage cost', () => {
  it('sums costUsd across messages', () => {
    expect(
      sumUsage([
        { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
        { inputTokens: 20, outputTokens: 10, costUsd: 0.02 },
        { inputTokens: 5, outputTokens: 1 },
      ]),
    ).toEqual({
      inputTokens: 35,
      outputTokens: 16,
      costUsd: 0.03,
    });
  });

  it('omits costUsd when no message has it', () => {
    expect(sumUsage([{ inputTokens: 10, outputTokens: 5 }])).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });
});

describe('usageTooltip cost', () => {
  it('includes cost only when showCost is true', () => {
    const u = { inputTokens: 10, outputTokens: 5, costUsd: 0.0042 };
    expect(usageTooltip(u)).not.toContain('Cost');
    expect(usageTooltip(u, { showCost: true })).toContain('Cost $0.0042');
  });
});

describe('formatCostSuffix', () => {
  it('is empty when showCost is off', () => {
    expect(formatCostSuffix(0.01, false)).toBe('');
    expect(formatCostSuffix(null, true)).toBe('');
  });

  it('formats when showCost is on', () => {
    expect(formatCostSuffix(0.01, true)).toBe(' · $0.01');
  });
});
