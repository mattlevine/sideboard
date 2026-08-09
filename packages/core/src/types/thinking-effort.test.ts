import { describe, expect, it } from 'vitest';
import {
  isThinkingEffort,
  nextThinkingEffort,
  normalizeThinkingEffort,
  thinkingEffortBars,
  thinkingEffortLabel,
  THINKING_EFFORTS,
} from './thinking-effort.js';

describe('thinking effort', () => {
  it('exposes the Conductor / Claude Code 5-level ladder', () => {
    expect(THINKING_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('normalizes Conductor normal → medium', () => {
    expect(normalizeThinkingEffort('normal')).toBe('medium');
    expect(normalizeThinkingEffort('xhigh')).toBe('xhigh');
    expect(normalizeThinkingEffort('nope')).toBeNull();
    expect(isThinkingEffort('max')).toBe(true);
  });

  it('cycles like Conductor ⌥T', () => {
    expect(nextThinkingEffort('low')).toBe('medium');
    expect(nextThinkingEffort('high')).toBe('xhigh');
    expect(nextThinkingEffort('max')).toBe('low');
  });

  it('fills 1–5 bars (High = 3)', () => {
    expect(thinkingEffortBars('low')).toBe(1);
    expect(thinkingEffortBars('medium')).toBe(2);
    expect(thinkingEffortBars('high')).toBe(3);
    expect(thinkingEffortBars('xhigh')).toBe(4);
    expect(thinkingEffortBars('max')).toBe(5);
    expect(thinkingEffortLabel('xhigh')).toBe('Extra High');
  });
});
