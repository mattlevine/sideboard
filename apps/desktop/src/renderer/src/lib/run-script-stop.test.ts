import { describe, expect, it } from 'vitest';
import { runMenuActionLabel } from './run-script-stop';

describe('runMenuActionLabel', () => {
  it('labels a running script as Stop and an idle script by name', () => {
    expect(runMenuActionLabel('mobile', true)).toBe('Stop Mobile');
    expect(runMenuActionLabel('dev', false)).toBe('Dev');
  });
});
