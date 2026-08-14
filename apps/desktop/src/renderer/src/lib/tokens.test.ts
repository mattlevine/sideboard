import { describe, expect, it } from 'vitest';
import { contextFillRatio, contextTokens } from './tokens';

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
