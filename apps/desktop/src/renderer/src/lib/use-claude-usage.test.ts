import { describe, expect, it } from 'vitest';
import {
  CLAUDE_USAGE_DEBOUNCE_MS,
  claudeUsageLoadDelay,
  shouldShowClaudePlanUsage,
} from './use-claude-usage';

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

  it('shows on worktree chats for every agent', () => {
    expect(
      shouldShowClaudePlanUsage({
        agent: 'cursor',
        sourceType: 'prompt',
        repoPath: '/repo',
      }),
    ).toBe(true);
    expect(
      shouldShowClaudePlanUsage({
        agent: 'codex',
        sourceType: 'branch',
        repoPath: '/repo',
      }),
    ).toBe(true);
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

describe('claudeUsageLoadDelay', () => {
  it('fetches immediately before the first reading', () => {
    expect(claudeUsageLoadDelay(false)).toBe(0);
  });

  it('debounces later nonce-triggered reloads', () => {
    expect(claudeUsageLoadDelay(true)).toBe(CLAUDE_USAGE_DEBOUNCE_MS);
  });
});
