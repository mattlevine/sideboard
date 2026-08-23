import { describe, expect, it } from 'vitest';
import {
  RECONCILE_HEAL_MIN_MS,
  shouldReadThreadToHealReconcile,
} from './reconcile-heal.js';

describe('shouldReadThreadToHealReconcile', () => {
  it('skips streaming and partial tool frames', () => {
    expect(shouldReadThreadToHealReconcile('stdout', undefined, 0)).toBe(false);
    expect(shouldReadThreadToHealReconcile('thinking', undefined, 0)).toBe(false);
    expect(shouldReadThreadToHealReconcile('stderr', undefined, 0)).toBe(false);
    expect(shouldReadThreadToHealReconcile('usage', undefined, 0)).toBe(false);
    expect(shouldReadThreadToHealReconcile('tool_result', undefined, 0)).toBe(false);
  });

  it('allows tool_use and session_id, then throttles', () => {
    expect(shouldReadThreadToHealReconcile('tool_use', undefined, 1000)).toBe(true);
    expect(shouldReadThreadToHealReconcile('session_id', undefined, 1000)).toBe(true);
    expect(
      shouldReadThreadToHealReconcile('tool_use', 1000, 1000 + RECONCILE_HEAL_MIN_MS - 1),
    ).toBe(false);
    expect(
      shouldReadThreadToHealReconcile('tool_use', 1000, 1000 + RECONCILE_HEAL_MIN_MS),
    ).toBe(true);
  });
});
