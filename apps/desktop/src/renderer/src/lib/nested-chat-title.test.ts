import { describe, expect, it } from 'vitest';
import { nestedChatDisplayTitle } from './nested-chat-title';

const spinnerChat = {
  worktreePath: '/wt/lens',
  branchName: 'feat/replace-spinner',
  prTitle: 'feat: replace full-page spinner',
};

describe('nestedChatDisplayTitle', () => {
  it('does not repeat the worktree name on the first unsynced chat', () => {
    expect(
      nestedChatDisplayTitle(
        { title: 'Kashiwa Reysol', userSetTitle: false, worktreePath: '/wt/kashiwa-reysol' },
        'Kashiwa Reysol',
      ),
    ).toBe('New agent');
  });

  it('keeps a soccer nickname that is not the parent', () => {
    expect(
      nestedChatDisplayTitle(
        {
          title: 'Sanfrecce Hiroshima',
          userSetTitle: true,
          worktreePath: '/wt/kashiwa-reysol',
        },
        'Kashiwa Reysol',
      ),
    ).toBe('Sanfrecce Hiroshima');
  });

  it('recovers the soccer nickname when a pre-update chat stored the PR title', () => {
    expect(
      nestedChatDisplayTitle(
        {
          ...spinnerChat,
          title: 'feat: replace full-page spinner',
          userSetTitle: false,
        },
        'feat: replace full-page spinner',
      ),
    ).toBe('Lens');
  });

  it('treats a truncated PR copy as the worktree, not the agent', () => {
    expect(
      nestedChatDisplayTitle(
        {
          ...spinnerChat,
          title: 'feat: replace full-page spinn',
          userSetTitle: false,
        },
        'feat: replace full-page spinner',
      ),
    ).toBe('Lens');
  });

  it('keeps a purpose name that is not the PR', () => {
    expect(
      nestedChatDisplayTitle(
        {
          ...spinnerChat,
          title: 'Add dark mode to settings',
          userSetTitle: false,
        },
        'feat: replace full-page spinner',
      ),
    ).toBe('Add dark mode to settings');
  });

  it('treats Untitled as an unnamed first chat', () => {
    expect(
      nestedChatDisplayTitle(
        { title: 'Untitled', userSetTitle: false, worktreePath: '/wt/lens' },
        'Lens',
      ),
    ).toBe('New agent');
  });

  it('does not keep Orchestration as the agent name', () => {
    expect(
      nestedChatDisplayTitle(
        {
          title: 'Orchestration',
          userSetTitle: false,
          worktreePath: '__global__',
        },
        'Orchestration',
      ),
    ).toBe('New agent');
  });
});
