import { describe, expect, it } from 'vitest';
import { closeChatTabMessage } from './close-chat-tab';

describe('closeChatTabMessage', () => {
  it('warns when closing the last tab in a worktree', () => {
    expect(closeChatTabMessage('Fix sidebar', 1)).toContain('last tab');
    expect(closeChatTabMessage('Fix sidebar', 1)).toContain('Fix sidebar');
  });

  it('mentions History when other tabs remain', () => {
    expect(closeChatTabMessage('Research', 2)).toContain('History');
    expect(closeChatTabMessage('Research', 2)).not.toContain('last tab');
  });
});
