import { describe, expect, it } from 'vitest';
import { billedUsageLabel, contextFillRatio, contextMeterTooltip, contextOccupancyLabel, contextTokens, formatCostSuffix, formatCostUsd, formatTokenCount, meterOccupancyTokens, resolveContextWindow, sumUsage, tabsContextLabel, totalTokens, usageTooltip } from './tokens';

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

  it('does not fill a full ring from billed-turn occupancy over the window', () => {
    const usage = {
      inputTokens: 800_000,
      outputTokens: 50_000,
      cacheReadTokens: 1_600_000,
      lastRequestTokens: 2_500_000,
    };
    expect(meterOccupancyTokens(usage, 1_000_000)).toBeNull();
    expect(contextFillRatio(usage, 1_000_000)).toBe(0);
    expect(contextMeterTooltip(usage, 1_000_000)).toContain('Billed');
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

describe('contextMeterTooltip', () => {
  it('names remaining occupancy after compression', () => {
    const usage = { inputTokens: 10, outputTokens: 2, lastRequestTokens: 12_000 };
    expect(contextMeterTooltip(usage, 1_000_000, { compacted: true })).toContain(
      'remaining after compression',
    );
    expect(contextMeterTooltip(usage, 1_000_000)).toContain('next request input + cache');
  });

  it('keeps the billed thread sum in the tooltip, not the occupancy label', () => {
    const usage = { inputTokens: 10, outputTokens: 2, lastRequestTokens: 94_000 };
    expect(contextOccupancyLabel(usage, 1_000_000)).toBe('94k / 1M');
    expect(contextOccupancyLabel(usage, 1_000_000)).not.toContain('3.4');
    expect(
      contextMeterTooltip(usage, 1_000_000, { billedTotal: 3_400_000 }),
    ).toContain('Thread billed Σ 3.4M');
  });
});

describe('billedUsageLabel', () => {
  it('matches the worktree hover card (billed tok, no / window)', () => {
    const usage = {
      inputTokens: 1_200_000,
      outputTokens: 200_000,
      cacheReadTokens: 3_200_000,
    };
    expect(billedUsageLabel(usage, false)).toBe('4.6M tok');
    expect(billedUsageLabel(usage, false)).not.toContain('/');
    expect(billedUsageLabel({ ...usage, costUsd: 1.23 }, true)).toBe('4.6M tok · $1.23');
  });
});

describe('tabsContextLabel', () => {
  it('shows occupancy against the fixed 1M window', () => {
    const usage = { inputTokens: 10, outputTokens: 2, lastRequestTokens: 94_000 };
    const billed = { inputTokens: 1_200_000, outputTokens: 200_000, cacheReadTokens: 3_200_000 };
    expect(tabsContextLabel(usage, 1_000_000, billed, false)).toBe('94k / 1M');
  });

  it('keeps / 1M when occupancy is a billed leak', () => {
    const leak = {
      inputTokens: 800_000,
      outputTokens: 50_000,
      cacheReadTokens: 1_600_000,
      lastRequestTokens: 2_500_000,
    };
    expect(tabsContextLabel(leak, 1_000_000, leak, false)).toBe('2.5M tok / 1M');
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
