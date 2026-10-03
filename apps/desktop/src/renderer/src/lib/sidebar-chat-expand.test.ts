import { describe, expect, it } from 'vitest';
import {
  resolveSidebarChatExpanded,
  worktreeSidebarMeta,
} from './sidebar-chat-expand';

describe('sidebar-chat-expand', () => {
  it('stays collapsed until the worktree is selected', () => {
    expect(
      resolveSidebarChatExpanded({ chatCount: 2, selected: false }),
    ).toBe(false);
    expect(
      resolveSidebarChatExpanded({ chatCount: 1, selected: false }),
    ).toBe(false);
    expect(
      resolveSidebarChatExpanded({ chatCount: 3, selected: true }),
    ).toBe(true);
  });

  it('does not nest a single chat under the parent card', () => {
    expect(
      resolveSidebarChatExpanded({ chatCount: 1, selected: true }),
    ).toBe(false);
  });

  it('lets the selected worktree collapse its nested chats', () => {
    expect(
      resolveSidebarChatExpanded({
        chatCount: 2,
        selected: true,
        collapsedWhileSelected: true,
      }),
    ).toBe(false);
  });
});

describe('worktreeSidebarMeta', () => {
  it('always shows the agent, like the previous sidebar', () => {
    expect(worktreeSidebarMeta({ agent: 'cursor', chatCount: 1 })).toBe(
      'cursor',
    );
  });

  it('adds the agent count when a worktree has more than one chat', () => {
    expect(worktreeSidebarMeta({ agent: 'cursor', chatCount: 2 })).toBe(
      'cursor · 2 agents',
    );
    expect(
      worktreeSidebarMeta({ agent: 'cursor', chatCount: 5, port: 56338 }),
    ).toBe('cursor · 5 agents · :56338');
  });

  it('keeps the git branch on the meta line when the title is a PR', () => {
    expect(
      worktreeSidebarMeta({
        agent: 'cursor',
        chatCount: 1,
        branch: 'feat/replace-spinner',
      }),
    ).toBe('feat/replace-spinner · cursor');
  });

  it('shows Archiving instead of agent meta', () => {
    expect(
      worktreeSidebarMeta({
        agent: 'cursor',
        chatCount: 1,
        archiving: true,
      }),
    ).toBe('Archiving…');
  });
});
