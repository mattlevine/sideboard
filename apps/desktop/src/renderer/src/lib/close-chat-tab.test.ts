import { describe, expect, it } from 'vitest';
import { archiveWorktreeMessage, closeChatTabMessage } from './close-chat-tab';

describe('closeChatTabMessage', () => {
  it('warns when closing the last tab in a worktree', () => {
    expect(closeChatTabMessage('Fix sidebar', 1)).toContain('last tab');
    expect(closeChatTabMessage('Fix sidebar', 1)).toContain('Fix sidebar');
  });

  it('skips worktree warning for global / orchestration chats', () => {
    expect(closeChatTabMessage('Monaco', 1, { removesWorktree: false })).toContain(
      'Settings → History',
    );
    expect(closeChatTabMessage('Monaco', 1, { removesWorktree: false })).not.toContain(
      'worktree',
    );
  });

  it('mentions History when other tabs remain', () => {
    expect(closeChatTabMessage('Research', 2)).toContain('Settings → History');
    expect(closeChatTabMessage('Research', 2)).not.toContain('last tab');
  });
});

describe('archiveWorktreeMessage', () => {
  it('archives the checkout, not a single chat tab', () => {
    expect(archiveWorktreeMessage('Login', 3)).toContain('All 3 chats');
    expect(archiveWorktreeMessage('Login', 3)).toContain('worktree will be removed');
    expect(archiveWorktreeMessage('Login', 1)).toContain('This worktree will be removed');
  });

  it('keeps the project folder for cowboy', () => {
    expect(archiveWorktreeMessage('Cowboy · main', 1, { cowboy: true })).toContain(
      'project folder stays',
    );
    expect(archiveWorktreeMessage('Cowboy · main', 1, { cowboy: true })).not.toContain(
      'worktree will be removed',
    );
  });
});
