import { describe, expect, it } from 'vitest';
import {
  IMPLIED_TICKET_RESOLVE_PROMPT,
  resolveCreateFirstPrompt,
} from './implied-first-prompt.js';

describe('resolveCreateFirstPrompt', () => {
  it('uses the typed prompt when present', () => {
    expect(
      resolveCreateFirstPrompt({
        sourceType: 'ticket',
        prompt: '  only plan  ',
      }),
    ).toBe('only plan');
  });

  it('implies resolve for a new ticket create with no extra text', () => {
    expect(resolveCreateFirstPrompt({ sourceType: 'ticket' })).toBe(
      IMPLIED_TICKET_RESOLVE_PROMPT,
    );
  });

  it('does not imply resolve for branch or PR creates', () => {
    expect(resolveCreateFirstPrompt({ sourceType: 'branch' })).toBeUndefined();
    expect(resolveCreateFirstPrompt({ sourceType: 'pr' })).toBeUndefined();
  });

  it('leaves orchestration children waiting for send_to_thread', () => {
    expect(
      resolveCreateFirstPrompt({
        sourceType: 'ticket',
        parentThreadId: 'orch-1',
      }),
    ).toBeUndefined();
  });

  it('does not re-nudge a reused ticket thread that already has chat', () => {
    expect(
      resolveCreateFirstPrompt({
        sourceType: 'ticket',
        reused: true,
        hasUserMessages: true,
      }),
    ).toBeUndefined();
  });

  it('starts an unused reused ticket worktree', () => {
    expect(
      resolveCreateFirstPrompt({
        sourceType: 'ticket',
        reused: true,
        hasUserMessages: false,
      }),
    ).toBe(IMPLIED_TICKET_RESOLVE_PROMPT);
  });
});
