import { describe, expect, it } from 'vitest';
import { createAllowEmpty } from '../../../../apps/mobile/account-defaults.ts';

describe('createAllowEmpty', () => {
  it('allows a blank send only for a project ticket or a new worktree chat', () => {
    expect(createAllowEmpty('project', 'ticket')).toBe(true);
    expect(createAllowEmpty('project', 'default')).toBe(false);
    expect(createAllowEmpty('project', 'pr')).toBe(false);
    expect(createAllowEmpty('project', 'branch')).toBe(false);
    expect(createAllowEmpty('worktree', 'default')).toBe(true);
    expect(createAllowEmpty('orchestration', 'default')).toBe(false);
  });
});
