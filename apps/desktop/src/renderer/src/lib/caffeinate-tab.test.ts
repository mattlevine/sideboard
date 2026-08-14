import { describe, expect, it } from 'vitest';
import { chatTabIsCaffeinated } from './caffeinate-tab';

const orch = { id: 'orch-a', sourceType: 'orchestration' as const, repoPath: '__global__' };
const other = { id: 'orch-b', sourceType: 'orchestration' as const, repoPath: '__global__' };
const worktree = { id: 'wt-1', sourceType: 'branch' as const, repoPath: '/repo' };

describe('chatTabIsCaffeinated', () => {
  it('is false when nothing is holding', () => {
    expect(chatTabIsCaffeinated(orch, { held: false, threadIds: [] })).toBe(false);
    expect(chatTabIsCaffeinated(orch, null)).toBe(false);
  });

  it('badges only the holding orchestration tab', () => {
    const hold = { held: true, threadIds: ['orch-a'] };
    expect(chatTabIsCaffeinated(orch, hold)).toBe(true);
    expect(chatTabIsCaffeinated(other, hold)).toBe(false);
    expect(chatTabIsCaffeinated(worktree, hold)).toBe(false);
  });

  it('badges orchestration tabs for a legacy hold with no thread ids', () => {
    const hold = { held: true, threadIds: [] };
    expect(chatTabIsCaffeinated(orch, hold)).toBe(true);
    expect(chatTabIsCaffeinated(worktree, hold)).toBe(false);
  });

  it('badges orchestration tabs when the app is caffeinating from settings', () => {
    expect(chatTabIsCaffeinated(orch, { held: false, threadIds: [] }, true)).toBe(
      true,
    );
    expect(chatTabIsCaffeinated(worktree, { held: false, threadIds: [] }, true)).toBe(
      false,
    );
  });
});
