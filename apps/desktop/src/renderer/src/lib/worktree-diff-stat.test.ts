import { describe, expect, it } from 'vitest';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';
import { shouldSkipWorktreeDirtyStat } from './worktree-diff-stat';

describe('shouldSkipWorktreeDirtyStat', () => {
  it('skips the global coordinator when worktreePath is the synthetic cwd', () => {
    expect(
      shouldSkipWorktreeDirtyStat(
        '/Users/me/Library/Application Support/Sideboard/global',
        GLOBAL_WORKSPACE_ID,
      ),
    ).toBe(true);
  });

  it('loads a project worktree', () => {
    expect(
      shouldSkipWorktreeDirtyStat('/repo/worktrees/bragantino', '/repo'),
    ).toBe(false);
  });

  it('skips an empty path and the sentinel worktree path', () => {
    expect(shouldSkipWorktreeDirtyStat('', '/repo')).toBe(true);
    expect(shouldSkipWorktreeDirtyStat(GLOBAL_WORKSPACE_ID, '/repo')).toBe(true);
  });
});
