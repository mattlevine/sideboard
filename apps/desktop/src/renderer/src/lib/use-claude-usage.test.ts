import { describe, expect, it } from 'vitest';
import { shouldShowClaudePlanUsage } from './use-claude-usage';

describe('shouldShowClaudePlanUsage', () => {
  it('shows on worktree Claude chats', () => {
    expect(
      shouldShowClaudePlanUsage({
        agent: 'claude',
        sourceType: 'prompt',
        repoPath: '/repo',
      }),
    ).toBe(true);
  });

  it('hides on worktree chats that are not Claude', () => {
    expect(
      shouldShowClaudePlanUsage({
        agent: 'cursor',
        sourceType: 'prompt',
        repoPath: '/repo',
      }),
    ).toBe(false);
  });

  it('shows on Global / orchestration chats even when the coordinator is not Claude', () => {
    expect(
      shouldShowClaudePlanUsage({
        agent: 'cursor',
        sourceType: 'orchestration',
        repoPath: '__global__',
      }),
    ).toBe(true);
    expect(
      shouldShowClaudePlanUsage({
        agent: 'codex',
        sourceType: 'orchestration',
        repoPath: '/repo',
      }),
    ).toBe(true);
  });

  it('is false when no thread is open', () => {
    expect(shouldShowClaudePlanUsage(null)).toBe(false);
  });
});
