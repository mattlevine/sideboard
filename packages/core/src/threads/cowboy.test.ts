import { describe, expect, it } from 'vitest';
import {
  isCowboyThread,
  isPrimaryCheckoutThread,
  shouldRemoveWorktreeOnTeardown,
} from './cowboy.js';

describe('cowboy helpers', () => {
  it('treats cowboy chats as primary checkouts that must not be removed', () => {
    const thread = {
      cowboy: true,
      worktreePath: '/Users/me/proj',
      repoPath: '/Users/me/proj',
    };
    expect(isCowboyThread(thread)).toBe(true);
    expect(isPrimaryCheckoutThread(thread)).toBe(true);
    expect(shouldRemoveWorktreeOnTeardown(thread)).toBe(false);
  });

  it('still protects an adopted primary checkout without the cowboy flag', () => {
    const thread = {
      cowboy: false,
      worktreePath: '/tmp/repo/',
      repoPath: '/tmp/repo',
    };
    expect(isCowboyThread(thread)).toBe(false);
    expect(isPrimaryCheckoutThread(thread)).toBe(true);
    expect(shouldRemoveWorktreeOnTeardown(thread)).toBe(false);
  });

  it('removes isolated thread worktrees', () => {
    const thread = {
      cowboy: false,
      worktreePath: '/tmp/sideboard/workspaces/repo/ajax',
      repoPath: '/tmp/repo',
    };
    expect(shouldRemoveWorktreeOnTeardown(thread)).toBe(true);
  });
});
