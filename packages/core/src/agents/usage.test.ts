import { describe, expect, it } from 'vitest';
import {
  applyTurnUsage,
  contextTokens,
  fromInclusiveInputUsage,
  requestOccupancy,
  sumUsageList,
} from './usage.js';

describe('fromInclusiveInputUsage', () => {
  it('subtracts cached tokens that are already inside input', () => {
    expect(
      fromInclusiveInputUsage({
        inputTokens: 18_424,
        outputTokens: 26,
        cachedInputTokens: 11_008,
      }),
    ).toEqual({
      inputTokens: 7_416,
      outputTokens: 26,
      cacheReadTokens: 11_008,
    });
  });

  it('leaves usage unchanged when nothing was cached', () => {
    expect(
      fromInclusiveInputUsage({ inputTokens: 100, outputTokens: 10 }),
    ).toEqual({ inputTokens: 100, outputTokens: 10 });
  });
});

describe('sumUsageList', () => {
  it('sums billed tokens and cost across turns', () => {
    expect(
      sumUsageList([
        { inputTokens: 100, outputTokens: 10, costUsd: 0.01, lastRequestTokens: 50 },
        { inputTokens: 200, outputTokens: 20, costUsd: 0.02 },
        { inputTokens: 50, outputTokens: 5 },
      ]),
    ).toEqual({
      inputTokens: 350,
      outputTokens: 35,
      costUsd: 0.03,
    });
  });

  it('returns null when nothing has usage', () => {
    expect(sumUsageList([undefined, null])).toBeNull();
  });
});

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

  it('sums costUsd across request-scoped steps', () => {
    const afterFirst = applyTurnUsage(
      null,
      { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
      'request',
    );
    const afterSecond = applyTurnUsage(
      afterFirst,
      { inputTokens: 50, outputTokens: 5, costUsd: 0.002 },
      'request',
    );
    expect(afterSecond.costUsd).toBeCloseTo(0.003);
  });

  it('prefers turn-scoped costUsd over the running request sum', () => {
    const stepped = applyTurnUsage(
      applyTurnUsage(
        null,
        { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
        'request',
      ),
      { inputTokens: 50, outputTokens: 5, costUsd: 0.002 },
      'request',
    );
    const withTotal = applyTurnUsage(
      stepped,
      { inputTokens: 150, outputTokens: 15, costUsd: 0.004 },
      'turn',
    );
    expect(withTotal.costUsd).toBe(0.004);
  });

  it('keeps request sum when turn total has no costUsd', () => {
    const stepped = applyTurnUsage(
      null,
      { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
      'request',
    );
    const withTotal = applyTurnUsage(
      stepped,
      { inputTokens: 100, outputTokens: 10 },
      'turn',
    );
    expect(withTotal.costUsd).toBe(0.001);
  });
});
