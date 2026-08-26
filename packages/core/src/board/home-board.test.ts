import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/thread.js';
import {
  BOARD_PAGE_SIZE,
  assembleHomeBoard,
  backlogIssues,
  backlogPins,
  boardIssueKey,
  boardPrKey,
  classifyThreadColumn,
  classifyWorktreeColumn,
  groupHomeBoardWorktrees,
  isHomeBoardThread,
  compactPreview,
  dedupeBoardIssues,
  dedupeBoardPrs,
  defaultTicketScope,
  findBoardIssue,
  findBoardPr,
  findLiveThreadForCreate,
  haystackMatches,
  issueInTicketScope,
  issueNeedsWorkspacePick,
  issueSearchText,
  pickDefaultRepoPath,
  prSearchText,
  reviewPrs,
  syncBoardPins,
  threadMatchesIssue,
  threadMatchesPr,
  threadSearchText,
  tokenizeQuery,
  visiblePage,
  type BoardIssue,
  type BoardPin,
  type BoardPr,
} from './home-board.js';

function thread(
  partial: Partial<Thread> & Pick<Thread, 'id'>,
): Thread {
  return {
    title: partial.title ?? 't',
    sourceType: partial.sourceType ?? 'branch',
    sourceRef: partial.sourceRef ?? 'main',
    branchName: partial.branchName ?? 'feature',
    worktreePath: partial.worktreePath ?? `/wt/${partial.id}`,
    repoPath: partial.repoPath ?? '/repo',
    agent: partial.agent ?? 'claude',
    model: partial.model ?? null,
    effort: partial.effort ?? 'high',
    fast: partial.fast ?? false,
    planMode: partial.planMode ?? false,
    sessionId: partial.sessionId ?? null,
    autonomy: partial.autonomy ?? 'default',
    sourceIsFork: partial.sourceIsFork ?? false,
    status: partial.status ?? 'idle',
    queue: partial.queue ?? [],
    parentThreadId: partial.parentThreadId ?? null,
    devPort: partial.devPort ?? null,
    prUrl: partial.prUrl ?? null,
    prTitle: partial.prTitle ?? null,
    prState: partial.prState ?? null,
    stackId: partial.stackId ?? null,
    stackLayer: partial.stackLayer ?? null,
    userSetTitle: partial.userSetTitle ?? false,
    createdAt: partial.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-08-01T00:00:00.000Z',
    messages: partial.messages ?? [],
    attachments: partial.attachments ?? [],
    lastError: partial.lastError,
    ...partial,
  };
}

function pin(
  partial: Partial<BoardPin> & Pick<BoardPin, 'id' | 'kind' | 'ref'>,
): BoardPin {
  return {
    repoPath: '/repo',
    addedAt: '2026-08-01T00:00:00.000Z',
    title: partial.title ?? partial.ref,
    needsWorkspacePick: false,
    ...partial,
  };
}

function issue(partial: Partial<BoardIssue> & Pick<BoardIssue, 'identifier' | 'title'>): BoardIssue {
  return {
    id: partial.id ?? partial.identifier,
    identifier: partial.identifier,
    title: partial.title,
    url: partial.url ?? '',
    labels: partial.labels ?? [],
    provider: partial.provider,
    repoPath: partial.repoPath ?? '/repo',
    needsWorkspacePick: partial.needsWorkspacePick ?? false,
    ...partial,
  };
}

describe('isHomeBoardThread', () => {
  it('includes every worktree chat and excludes orchestration', () => {
    expect(isHomeBoardThread(thread({ id: 'b', sourceType: 'branch' }))).toBe(true);
    expect(isHomeBoardThread(thread({ id: 't', sourceType: 'ticket' }))).toBe(true);
    expect(isHomeBoardThread(thread({ id: 'p', sourceType: 'pr' }))).toBe(true);
    expect(isHomeBoardThread(thread({ id: 'a', sourceType: 'adopt' }))).toBe(true);
    expect(
      isHomeBoardThread(thread({ id: 'c', sourceType: 'branch', cowboy: true })),
    ).toBe(true);
    expect(
      isHomeBoardThread(
        thread({
          id: 'o',
          sourceType: 'orchestration',
          repoPath: '__global__',
        }),
      ),
    ).toBe(false);
    expect(
      isHomeBoardThread(
        thread({ id: 'legacy', sourceType: 'orchestration', repoPath: '/repo' }),
      ),
    ).toBe(false);
    expect(
      isHomeBoardThread(thread({ id: 'g', sourceType: 'branch', repoPath: '__global__' })),
    ).toBe(false);
  });
});

describe('classifyThreadColumn', () => {
  it('maps merged and open PR into path-to-merge columns', () => {
    expect(classifyThreadColumn(thread({ id: 'a', status: 'archived' }))).toBe('needs_you');
    expect(classifyThreadColumn(thread({ id: 'q', status: 'queued' }))).toBe('needs_you');
    expect(classifyThreadColumn(thread({ id: 'r', status: 'running' }))).toBe('needs_you');
    expect(classifyThreadColumn(thread({ id: 'e', status: 'error' }))).toBe('needs_you');
    expect(classifyThreadColumn(thread({ id: 'b', status: 'broken' }))).toBe('needs_you');
    expect(
      classifyThreadColumn(
        thread({ id: 'ie', status: 'idle', lastError: 'provider 429' }),
      ),
    ).toBe('needs_you');
    expect(
      classifyThreadColumn(
        thread({
          id: 'pr',
          status: 'idle',
          prUrl: 'https://github.com/acme/app/pull/1',
          prState: 'OPEN',
        }),
      ),
    ).toBe('review');
    expect(
      classifyThreadColumn(
        thread({
          id: 'merged',
          status: 'idle',
          prUrl: 'https://github.com/acme/app/pull/2',
          prState: 'MERGED',
        }),
      ),
    ).toBe('done');
  });

  it('keeps an open PR in Review even while running or errored', () => {
    expect(
      classifyThreadColumn(
        thread({
          id: 'err-pr',
          status: 'idle',
          lastError: 'ci failed',
          prUrl: 'https://github.com/acme/app/pull/3',
          prState: 'OPEN',
        }),
      ),
    ).toBe('review');
    expect(
      classifyThreadColumn(
        thread({
          id: 'run-pr',
          status: 'running',
          prUrl: 'https://github.com/acme/app/pull/4',
          prState: 'OPEN',
        }),
      ),
    ).toBe('review');
    expect(
      classifyThreadColumn(
        thread({
          id: 'run-merged',
          status: 'running',
          prUrl: 'https://github.com/acme/app/pull/5',
          prState: 'MERGED',
        }),
      ),
    ).toBe('done');
  });
});

describe('groupHomeBoardWorktrees', () => {
  it('collapses sibling chats on the same checkout', () => {
    const groups = groupHomeBoardWorktrees([
      thread({
        id: 'old',
        worktreePath: '/wt/login',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
      thread({
        id: 'new',
        worktreePath: '/wt/login/',
        updatedAt: '2026-08-03T00:00:00.000Z',
      }),
      thread({
        id: 'other',
        worktreePath: '/wt/other',
        updatedAt: '2026-08-02T00:00:00.000Z',
      }),
    ]);
    expect(groups.map((g) => g.map((t) => t.id))).toEqual([['new', 'old'], ['other']]);
    expect(
      classifyWorktreeColumn([
        thread({ id: 'chat' }),
        thread({
          id: 'pr',
          prUrl: 'https://github.com/acme/app/pull/1',
          prState: 'OPEN',
        }),
      ]),
    ).toBe('review');
  });
});

describe('threadMatchesIssue', () => {
  it('matches ticket sourceRef and title/identifier', () => {
    expect(
      threadMatchesIssue(
        thread({ id: '1', sourceType: 'ticket', sourceRef: 'ENG-4', title: 'Ship' }),
        issue({ identifier: 'ENG-4', title: 'Ship it' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesIssue(
        thread({ id: '2', sourceType: 'ticket', sourceRef: '#12', title: 'Fix' }),
        issue({ identifier: '#12', title: 'Fix login' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesIssue(
        thread({ id: '3', sourceType: 'branch', sourceRef: 'main', title: 'ENG-4 login' }),
        issue({ identifier: 'ENG-4', title: 'Login' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesIssue(
        thread({ id: '4', sourceType: 'branch', sourceRef: 'main', title: 'Fix login' }),
        issue({ identifier: '#99', title: 'Fix login' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesIssue(
        thread({ id: '5', sourceType: 'branch', sourceRef: 'main', title: 'Other' }),
        issue({ identifier: 'ENG-4', title: 'Ship' }),
      ),
    ).toBe(false);
  });
});

describe('backlogIssues', () => {
  it('hides issues that already have a live thread, not archived ones', () => {
    const issues = [
      issue({ identifier: 'ENG-1', title: 'One' }),
      issue({ identifier: 'ENG-2', title: 'Two' }),
    ];
    const threads = [
      thread({ id: 'live', sourceType: 'ticket', sourceRef: 'ENG-1', title: 'One' }),
      thread({
        id: 'old',
        sourceType: 'ticket',
        sourceRef: 'ENG-2',
        title: 'Two',
        status: 'archived',
      }),
    ];
    expect(backlogIssues(issues, threads).map((i) => i.identifier)).toEqual(['ENG-2']);
  });
});

describe('dedupeBoardIssues / workspace pick', () => {
  it('dedupes Linear-style repeats and keeps GitHub per repo', () => {
    const linear = issue({
      id: 'lin-1',
      identifier: 'ENG-1',
      title: 'One',
      provider: 'linear',
      repoPath: '/a',
    });
    expect(
      dedupeBoardIssues([linear, { ...linear, repoPath: '/a' }]).map((i) => i.identifier),
    ).toEqual(['ENG-1']);
    expect(
      dedupeBoardIssues([
        issue({ identifier: '#1', title: 'A', provider: 'github', repoPath: '/a' }),
        issue({ identifier: '#1', title: 'A', provider: 'github', repoPath: '/b' }),
      ]),
    ).toHaveLength(2);
  });

  it('asks for a workspace pick on Linear when more than one repo is registered', () => {
    expect(issueNeedsWorkspacePick('github', 3)).toBe(false);
    expect(issueNeedsWorkspacePick('linear', 3)).toBe(true);
    expect(issueNeedsWorkspacePick('abletime', 2)).toBe(true);
    expect(issueNeedsWorkspacePick('linear', 1)).toBe(false);
    expect(pickDefaultRepoPath([{ path: '/a' }, { path: '/b' }], '/b')).toBe('/b');
    expect(pickDefaultRepoPath([{ path: '/a' }, { path: '/b' }], '__global__')).toBe('/a');
    expect(
      boardIssueKey(issue({ identifier: '#1', title: 'A', provider: 'github', repoPath: '/a' })),
    ).not.toBe(
      boardIssueKey(issue({ identifier: '#1', title: 'A', provider: 'github', repoPath: '/b' })),
    );
    expect(
      boardIssueKey(issue({ identifier: 'ENG-1', title: 'A', provider: 'linear', repoPath: '/a' })),
    ).toBe(
      boardIssueKey(issue({ identifier: 'ENG-1', title: 'A', provider: 'linear', repoPath: '/b' })),
    );
  });
});

function pr(partial: Partial<BoardPr> & Pick<BoardPr, 'number' | 'title'>): BoardPr {
  return {
    number: partial.number,
    title: partial.title,
    headRefName: partial.headRefName ?? `head-${partial.number}`,
    url: partial.url ?? `https://github.com/acme/app/pull/${partial.number}`,
    isCrossRepository: partial.isCrossRepository ?? false,
    repoPath: partial.repoPath ?? '/repo',
  };
}

describe('threadMatchesPr / reviewPrs', () => {
  it('matches PR sourceRef, prUrl, and head branch', () => {
    expect(
      threadMatchesPr(
        thread({ id: '1', sourceType: 'pr', sourceRef: '9', title: 'Ship' }),
        pr({ number: 9, title: 'Ship' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesPr(
        thread({
          id: '2',
          sourceType: 'ticket',
          sourceRef: 'ENG-1',
          title: 'Ship',
          prUrl: 'https://github.com/acme/app/pull/9/',
        }),
        pr({ number: 9, title: 'Ship' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesPr(
        thread({
          id: '3',
          sourceType: 'branch',
          sourceRef: 'feat/login',
          branchName: 'thread/foo',
          title: 'Login',
        }),
        pr({ number: 4, title: 'Login', headRefName: 'feat/login' }),
      ),
    ).toBe(true);
    expect(
      threadMatchesPr(
        thread({ id: '4', sourceType: 'branch', sourceRef: 'main', title: 'Other' }),
        pr({ number: 9, title: 'Ship' }),
      ),
    ).toBe(false);
  });

  it('shows open PRs without a live thread in Review', () => {
    const prs = [
      pr({ number: 1, title: 'Mine' }),
      pr({ number: 2, title: 'Review me' }),
    ];
    const threads = [
      thread({ id: 'live', sourceType: 'pr', sourceRef: '1', title: 'Mine' }),
      thread({
        id: 'old',
        sourceType: 'pr',
        sourceRef: '2',
        title: 'Review me',
        status: 'archived',
      }),
    ];
    expect(reviewPrs(prs, threads).map((p) => p.number)).toEqual([2]);
  });

  it('dedupes the same PR url across workspaces', () => {
    const a = pr({ number: 8, title: 'Same', repoPath: '/a' });
    const b = { ...a, repoPath: '/b' };
    expect(dedupeBoardPrs([a, b])).toHaveLength(1);
    expect(boardPrKey(a)).toBe(boardPrKey(b));
  });
});

describe('board search and paging', () => {
  it('matches every query token against a haystack', () => {
    expect(tokenizeQuery('  Fix LOGIN  ')).toEqual(['fix', 'login']);
    expect(haystackMatches('#12 Fix login github /repo', ['#12', 'login'])).toBe(true);
    expect(haystackMatches('#12 Fix login', ['linear'])).toBe(false);
  });

  it('indexes issue, PR, and thread fields for search', () => {
    expect(
      haystackMatches(
        issueSearchText(
          issue({ identifier: 'ENG-9', title: 'Pay wall', labels: ['billing'], provider: 'linear', repoPath: '/app' }),
          'app',
        ),
        ['eng-9', 'billing'],
      ),
    ).toBe(true);
    expect(
      haystackMatches(
        prSearchText(pr({ number: 44, title: 'Review queue', headRefName: 'feat/queue' }), 'core'),
        ['#44', 'queue'],
      ),
    ).toBe(true);
    expect(
      haystackMatches(
        threadSearchText(
          thread({ id: 't', title: 'Ship login', agent: 'cursor', sourceRef: 'ENG-9', repoPath: '/app' }),
          'app',
        ),
        ['cursor', 'eng-9'],
      ),
    ).toBe(true);
  });

  it('pages long columns without dropping the remainder count', () => {
    const items = Array.from({ length: 95 }, (_, i) => i);
    expect(visiblePage(items, BOARD_PAGE_SIZE)).toEqual({
      visible: items.slice(0, 40),
      hidden: 55,
    });
    expect(compactPreview('one\n\ntwo   three', 8)).toBe('one two…');
  });
});

describe('assembleHomeBoard', () => {
  it('places worktree threads by agent and PR state', () => {
    const snap = assembleHomeBoard({
      pins: [
        pin({ id: 't1', kind: 'ticket', ref: 'ENG-1', title: 'Login', provider: 'linear' }),
      ],
      threads: [
        thread({
          id: 'live',
          sourceType: 'ticket',
          sourceRef: 'ENG-2',
          title: 'Taken',
          status: 'running',
        }),
        thread({
          id: 'review',
          sourceType: 'pr',
          sourceRef: '9',
          title: 'Open review',
          prUrl: 'https://github.com/acme/app/pull/9',
          prState: 'OPEN',
          status: 'idle',
        }),
        thread({
          id: 'merged',
          sourceType: 'pr',
          sourceRef: '10',
          title: 'Landed',
          prUrl: 'https://github.com/acme/app/pull/10',
          prState: 'MERGED',
          status: 'idle',
        }),
        thread({
          id: 'history',
          sourceType: 'pr',
          sourceRef: '11',
          title: 'Old merge',
          prUrl: 'https://github.com/acme/app/pull/11',
          prState: 'MERGED',
          status: 'archived',
        }),
      ],
    });
    expect(snap.columns.backlog).toHaveLength(0);
    expect(snap.columns.needs_you).toHaveLength(1);
    expect(snap.columns.review).toHaveLength(1);
    expect(snap.columns.done).toHaveLength(1);
    expect(snap.columns.done[0] && snap.columns.done[0].kind === 'thread' && snap.columns.done[0].id).toBe('merged');
    expect(snap.totals).toMatchObject({
      backlog: 0,
      needs_you: 1,
      review: 1,
      done: 1,
      tickets: 1,
      prs: 2,
      threads: 3,
    });
  });

  it('filters by query, kind, column, and page limit', () => {
    const threads = [
      thread({ id: 'run', title: 'Pay worker', status: 'running', sourceType: 'ticket' }),
      thread({
        id: 'done',
        title: 'Old pay',
        status: 'idle',
        sourceType: 'branch',
        prUrl: 'https://github.com/acme/app/pull/8',
        prState: 'MERGED',
      }),
      thread({ id: 'other', title: 'Other', status: 'queued', sourceType: 'pr' }),
      thread({ id: 'history', title: 'Archived pay', status: 'archived', sourceType: 'branch' }),
    ];
    const queried = assembleHomeBoard({
      threads,
      query: 'pay',
    });
    expect(queried.columns.backlog).toHaveLength(0);
    expect(queried.columns.needs_you).toHaveLength(1);
    expect(queried.columns.done).toHaveLength(1);

    const ticketsOnly = assembleHomeBoard({
      threads,
      kind: 'tickets',
    });
    expect(ticketsOnly.totals.prs).toBe(0);
    expect(ticketsOnly.columns.needs_you).toHaveLength(1);
    expect(ticketsOnly.columns.review).toHaveLength(0);

    const paged = assembleHomeBoard({
      threads: Array.from({ length: 45 }, (_, i) =>
        thread({ id: `t${i}`, title: `Card ${i}`, status: 'running' }),
      ),
      limit: 10,
    });
    expect(paged.columns.needs_you).toHaveLength(10);
    expect(paged.hidden.needs_you).toBe(35);
    expect(paged.totals.needs_you).toBe(45);

    const col = assembleHomeBoard({
      threads,
      column: 'needs_you',
    });
    expect(col.columns.needs_you).toHaveLength(2);
    expect(col.columns.done).toHaveLength(0);
    expect(col.totals.done).toBe(1);
  });

  it('keeps picker cycle helpers and syncs pin metadata from remotes', () => {
    expect(defaultTicketScope('linear')).toBe('cycle');
    expect(issueInTicketScope(
      issue({
        identifier: 'ENG-1',
        title: 'Now',
        provider: 'linear',
        cycle: { name: 'Week 34', number: 34, isActive: true },
      }),
      'cycle',
    )).toBe(true);
    const synced = syncBoardPins(
      [pin({ id: 't1', kind: 'ticket', ref: 'ENG-1', title: 'Old', provider: 'linear' })],
      [
        issue({
          identifier: 'ENG-1',
          title: 'Now',
          provider: 'linear',
          cycle: { name: 'Week 34', isActive: true },
        }),
      ],
      [],
    );
    expect(synced[0]).toMatchObject({ title: 'Now', cycle: 'Week 34', remoteState: 'open' });
    expect(backlogPins(synced, []).map((p) => p.ref)).toEqual(['ENG-1']);
  });

  it('emits one card per worktree when several chats share a checkout', () => {
    const snap = assembleHomeBoard({
      threads: [
        thread({
          id: 'a',
          worktreePath: '/wt/login',
          title: 'Tab A',
          updatedAt: '2026-08-02T00:00:00.000Z',
        }),
        thread({
          id: 'b',
          worktreePath: '/wt/login',
          title: 'Tab B',
          updatedAt: '2026-08-03T00:00:00.000Z',
        }),
        thread({
          id: 'c',
          worktreePath: '/wt/other',
          title: 'Other',
        }),
        thread({
          id: 'review-tab',
          worktreePath: '/wt/pr',
          title: 'Review tab',
          prUrl: 'https://github.com/acme/app/pull/1',
          prState: 'OPEN',
        }),
        thread({
          id: 'review-chat',
          worktreePath: '/wt/pr',
          title: 'Plain chat',
        }),
      ],
    });
    expect(snap.totals.threads).toBe(3);
    expect(snap.columns.needs_you.map((c) => c.kind === 'thread' && c.id).sort()).toEqual(
      ['b', 'c'],
    );
    expect(snap.columns.review).toHaveLength(1);
    expect(snap.columns.review[0] && snap.columns.review[0].kind === 'thread' && snap.columns.review[0].id).toBe(
      'review-tab',
    );
    expect(snap.columns.review[0] && snap.columns.review[0].kind === 'thread' && snap.columns.review[0].chatCount).toBe(
      2,
    );
  });

  it('puts every worktree on the board, including sidebar and agent creates', () => {
    const snap = assembleHomeBoard({
      issues: [],
      prs: [],
      threads: [
        thread({
          id: 'sidebar',
          sourceType: 'branch',
          sourceRef: 'main',
          title: 'From sidebar',
          status: 'idle',
        }),
        thread({
          id: 'agent',
          sourceType: 'ticket',
          sourceRef: 'ENG-9',
          title: 'From agent',
          parentThreadId: 'orch-1',
          status: 'queued',
        }),
        thread({
          id: 'adopted',
          sourceType: 'adopt',
          title: 'Adopted wt',
          status: 'running',
        }),
        thread({
          id: 'cowboy',
          sourceType: 'branch',
          cowboy: true,
          title: 'On default branch',
          status: 'idle',
        }),
        thread({
          id: 'orch',
          sourceType: 'orchestration',
          repoPath: '__global__',
          title: 'Coordinator',
          status: 'running',
        }),
      ],
    });
    expect(snap.columns.needs_you.map((c) => c.kind === 'thread' && c.id).sort()).toEqual(
      ['adopted', 'agent', 'cowboy', 'sidebar'],
    );
    expect(snap.columns.review).toHaveLength(0);
    expect(snap.totals.threads).toBe(4);
    expect(
      snap.columns.needs_you.some((c) => c.kind === 'thread' && c.id === 'orch'),
    ).toBe(false);
  });

  it('reuses a live ticket, PR, or named branch — not a default-branch create', () => {
    const live = [
      thread({
        id: 'ticket',
        sourceType: 'ticket',
        sourceRef: 'ENG-4',
        title: 'Ship',
        repoPath: '/repo',
      }),
      thread({
        id: 'pr',
        sourceType: 'pr',
        sourceRef: '9',
        title: 'Fix',
        repoPath: '/repo',
      }),
      thread({
        id: 'named',
        sourceType: 'branch',
        sourceRef: 'feat/login',
        branchName: 'thread/limon',
        repoPath: '/repo',
      }),
      thread({
        id: 'from-default',
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: 'thread/other',
        repoPath: '/repo',
      }),
      thread({
        id: 'cowboy',
        sourceType: 'branch',
        sourceRef: 'main',
        branchName: 'main',
        cowboy: true,
        repoPath: '/repo',
      }),
    ];
    expect(
      findLiveThreadForCreate(
        { sourceType: 'ticket', sourceRef: 'ENG-4', repoPath: '/repo' },
        live,
      )?.id,
    ).toBe('ticket');
    expect(
      findLiveThreadForCreate(
        { sourceType: 'pr', sourceRef: '9', repoPath: '/repo' },
        live,
      )?.id,
    ).toBe('pr');
    expect(
      findLiveThreadForCreate(
        { sourceType: 'branch', sourceRef: 'feat/login', repoPath: '/repo' },
        live,
      )?.id,
    ).toBe('named');
    expect(
      findLiveThreadForCreate(
        { sourceType: 'branch', sourceRef: 'default', repoPath: '/repo' },
        live,
      ),
    ).toBeUndefined();
    expect(
      findLiveThreadForCreate(
        { sourceType: 'branch', sourceRef: 'main', repoPath: '/repo' },
        live,
      ),
    ).toBeUndefined();
    expect(
      findLiveThreadForCreate(
        { sourceType: 'branch', sourceRef: 'default', repoPath: '/repo', cowboy: true },
        live,
      )?.id,
    ).toBe('cowboy');
    expect(
      findLiveThreadForCreate(
        { sourceType: 'ticket', sourceRef: 'ENG-4', repoPath: '/other' },
        live,
      ),
    ).toBeUndefined();
  });

  it('resolves Start refs to the matching ticket or PR', () => {
    const issues = [
      issue({ identifier: '#12', title: 'A', repoPath: '/a', provider: 'github' }),
      issue({ identifier: '#12', title: 'B', repoPath: '/b', provider: 'github' }),
    ];
    expect(findBoardIssue(issues, '12', '/b')?.title).toBe('B');
    expect(findBoardIssue(issues, '#12', '/a')?.title).toBe('A');
    const prs = [
      pr({ number: 4, title: 'One', repoPath: '/a' }),
      pr({ number: 4, title: 'Two', repoPath: '/b', url: 'https://github.com/acme/b/pull/4' }),
    ];
    expect(findBoardPr(prs, '#4', '/b')?.title).toBe('Two');
  });
});
