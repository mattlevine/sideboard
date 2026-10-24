import { describe, expect, it } from 'vitest';
import { assembleHomeBoard } from './home-board.js';
import { issueBlockedByIds, issueBlockedLabel } from './issue-blocked-view.js';
import type { Thread } from '../types/thread.js';

describe('issueBlockedByIds', () => {
  it('dedupes blockers across chats on one worktree', () => {
    expect(
      issueBlockedByIds([
        { issueBlockedBy: ['ENG-88', ' ENG-91 '] },
        { issueBlockedBy: ['eng-91', 'ENG-88'] },
        {},
      ]),
    ).toEqual(['ENG-88', 'ENG-91']);
  });

  it('labels one or two ids and collapses the rest', () => {
    expect(issueBlockedLabel(['ENG-88'])).toBe('blocked by ENG-88');
    expect(issueBlockedLabel(['ENG-88', 'ENG-91'])).toBe('blocked by ENG-88, ENG-91');
    expect(issueBlockedLabel(['ENG-88', 'ENG-91', 'ENG-92'])).toBe('blocked by 3');
    expect(issueBlockedLabel([])).toBe('');
  });
});

function thread(partial: Partial<Thread> & Pick<Thread, 'id'>): Thread {
  return {
    title: 't',
    sourceType: 'ticket',
    sourceRef: 'ENG-1',
    branchName: 'feature',
    worktreePath: `/wt/${partial.id}`,
    repoPath: '/repo',
    agent: 'claude',
    model: null,
    effort: 'high',
    fast: false,
    planMode: false,
    sessionId: null,
    autonomy: 'default',
    sourceIsFork: false,
    status: 'idle',
    queue: [],
    parentThreadId: null,
    devPort: null,
    prUrl: null,
    prTitle: null,
    prState: null,
    stackId: null,
    stackLayer: null,
    userSetTitle: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [],
    attachments: [],
    ...partial,
  };
}

describe('assembleHomeBoard issueBlockedBy', () => {
  it('puts source-ticket blockers on the workspace card', () => {
    const snap = assembleHomeBoard({
      threads: [
        thread({
          id: 'blocked',
          title: 'Notify',
          issueBlockedBy: ['ENG-88'],
        }),
        thread({
          id: 'clear',
          title: 'Clear',
          worktreePath: '/wt/clear',
        }),
      ],
    });
    const cards = snap.columns.new;
    const blocked = cards.find((card) => card.kind === 'thread' && card.id === 'blocked');
    const clear = cards.find((card) => card.kind === 'thread' && card.id === 'clear');
    expect(blocked && blocked.kind === 'thread' ? blocked.issueBlockedBy : null).toEqual([
      'ENG-88',
    ]);
    expect(clear && clear.kind === 'thread' ? clear.issueBlockedBy : null).toBeUndefined();
  });
});
