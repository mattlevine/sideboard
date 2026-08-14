import { describe, expect, it } from 'vitest';
import { applyTurnUsage, contextTokens, requestOccupancy } from './usage.js';

describe('applyTurnUsage', () => {
  it('uses the last request occupancy for the meter, not the billed sum', () => {
    const afterFirst = applyTurnUsage(
      null,
      { inputTokens: 1_000, outputTokens: 50, cacheReadTokens: 40_000 },
      'request',
    );
    const afterSecond = applyTurnUsage(
      afterFirst,
      { inputTokens: 800, outputTokens: 40, cacheReadTokens: 80_000 },
      'request',
    );
    expect(afterSecond.inputTokens).toBe(1_800);
    expect(afterSecond.cacheReadTokens).toBe(120_000);
    expect(afterSecond.lastRequestTokens).toBe(80_800);
    expect(contextTokens(afterSecond)).toBe(80_800);
  });

  it('keeps last-request size when a turn total replaces billed sums', () => {
    const stepped = applyTurnUsage(
      applyTurnUsage(
        null,
        { inputTokens: 1_000, outputTokens: 10, cacheReadTokens: 40_000 },
        'request',
      ),
      { inputTokens: 500, outputTokens: 20, cacheReadTokens: 70_000 },
      'request',
    );
    const withTotal = applyTurnUsage(
      stepped,
      { inputTokens: 1_500, outputTokens: 30, cacheReadTokens: 110_000 },
      'turn',
    );
    expect(withTotal.inputTokens).toBe(1_500);
    expect(withTotal.lastRequestTokens).toBe(70_500);
    expect(contextTokens(withTotal)).toBe(70_500);
  });

  it('falls back to occupancy of a lone turn total', () => {
    const only = applyTurnUsage(
      null,
      { inputTokens: 120, outputTokens: 45, cacheReadTokens: 900, cacheWriteTokens: 300 },
      'turn',
    );
    expect(only.lastRequestTokens).toBe(1_320);
    expect(requestOccupancy(only)).toBe(1_320);
  });
});
