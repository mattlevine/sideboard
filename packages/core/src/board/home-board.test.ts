import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/thread.js';
import {
  BOARD_PAGE_SIZE,
  assembleHomeBoard,
  backlogIssues,
  boardIssueKey,
  boardPrKey,
  classifyThreadColumn,
  isHomeBoardThread,
  compactPreview,
  dedupeBoardIssues,
  dedupeBoardPrs,
  defaultTicketScope,
  findBoardIssue,
  findBoardPr,
  haystackMatches,
  issueInTicketScope,
  issueNeedsWorkspacePick,
  issueSearchText,
  pickDefaultRepoPath,
  prSearchText,
  reviewPrs,
  threadMatchesIssue,
  threadMatchesPr,
  threadSearchText,
  tokenizeQuery,
  visiblePage,
  type BoardIssue,
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
    worktreePath: partial.worktreePath ?? '/wt',
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
  it('maps agent and PR state into locked columns', () => {
    expect(classifyThreadColumn(thread({ id: 'a', status: 'archived' }))).toBe('done');
    expect(classifyThreadColumn(thread({ id: 'q', status: 'queued' }))).toBe('queued');
    expect(classifyThreadColumn(thread({ id: 'r', status: 'running' }))).toBe('running');
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
          id: 'closed',
          status: 'idle',
          prUrl: 'https://github.com/acme/app/pull/2',
          prState: 'MERGED',
        }),
      ),
    ).toBe('needs_you');
  });

  it('keeps errored threads with an open PR in Needs you', () => {
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
    ).toBe('needs_you');
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
  it('places unmatched tickets in Backlog and unmatched PRs in Review', () => {
    const snap = assembleHomeBoard({
      issues: [
        issue({ identifier: 'ENG-1', title: 'Login', provider: 'linear' }),
        issue({ identifier: 'ENG-2', title: 'Taken', provider: 'linear' }),
      ],
      prs: [
        pr({ number: 9, title: 'Open review', url: 'https://github.com/acme/app/pull/9' }),
      ],
      threads: [
        thread({
          id: 'live',
          sourceType: 'ticket',
          sourceRef: 'ENG-2',
          title: 'Taken',
          status: 'running',
        }),
      ],
    });
    expect(snap.columns.backlog.map((c) => c.kind === 'ticket' && c.identifier)).toEqual([
      'ENG-1',
    ]);
    expect(snap.columns.running).toHaveLength(1);
    expect(snap.columns.running[0]).toMatchObject({
      kind: 'thread',
      id: 'live',
      link: 'sideboard://thread/live',
    });
    expect(snap.columns.review.map((c) => c.kind === 'pr' && c.number)).toEqual([9]);
    expect(snap.totals).toMatchObject({
      backlog: 1,
      running: 1,
      review: 1,
      tickets: 1,
      prs: 1,
      threads: 1,
    });
  });

  it('filters by query, kind, column, and page limit', () => {
    const issues = Array.from({ length: 3 }, (_, i) =>
      issue({ identifier: `ENG-${i + 1}`, title: i === 0 ? 'Pay wall' : `Other ${i}` }),
    );
    const threads = [
      thread({ id: 'run', title: 'Pay worker', status: 'running' }),
      thread({ id: 'done', title: 'Old pay', status: 'archived' }),
    ];
    const queried = assembleHomeBoard({
      issues,
      prs: [],
      threads,
      query: 'pay',
    });
    expect(queried.columns.backlog).toHaveLength(1);
    expect(queried.columns.running).toHaveLength(1);
    expect(queried.columns.done).toHaveLength(1);

    const ticketsOnly = assembleHomeBoard({
      issues,
      prs: [pr({ number: 3, title: 'PR' })],
      threads,
      kind: 'tickets',
    });
    expect(ticketsOnly.totals.prs).toBe(0);
    expect(ticketsOnly.columns.running).toHaveLength(0);
    expect(ticketsOnly.columns.review).toHaveLength(0);

    const paged = assembleHomeBoard({
      issues: Array.from({ length: 45 }, (_, i) =>
        issue({ identifier: `T-${i}`, title: `Card ${i}` }),
      ),
      prs: [],
      threads: [],
      limit: 10,
    });
    expect(paged.columns.backlog).toHaveLength(10);
    expect(paged.hidden.backlog).toBe(35);
    expect(paged.totals.backlog).toBe(45);

    const col = assembleHomeBoard({
      issues,
      prs: [],
      threads,
      column: 'running',
    });
    expect(col.columns.running).toHaveLength(1);
    expect(col.columns.backlog).toHaveLength(0);
    expect(col.totals.backlog).toBe(3);
  });

  it('defaults Linear Backlog to the active cycle', () => {
    expect(defaultTicketScope('linear')).toBe('cycle');
    expect(defaultTicketScope('github')).toBe('all');
    expect(
      issueInTicketScope(
        issue({
          identifier: 'ENG-1',
          title: 'Now',
          provider: 'linear',
          cycle: { name: 'Week 34', number: 34, isActive: true },
        }),
        'cycle',
      ),
    ).toBe(true);
    expect(
      issueInTicketScope(
        issue({
          identifier: 'ENG-2',
          title: 'Later',
          provider: 'linear',
          cycle: { name: 'Week 35', number: 35, isActive: false },
        }),
        'cycle',
      ),
    ).toBe(false);
    expect(
      issueInTicketScope(
        issue({ identifier: 'ENG-2', title: 'Later', provider: 'linear' }),
        'assigned',
      ),
    ).toBe(true);
    expect(
      issueInTicketScope(
        issue({
          identifier: '#9',
          title: 'Mine',
          provider: 'github',
          assignees: ['octocat'],
        }),
        'assigned',
        'octocat',
      ),
    ).toBe(true);
    expect(
      issueInTicketScope(
        issue({
          identifier: '#8',
          title: 'Theirs',
          provider: 'github',
          assignees: ['other'],
        }),
        'assigned',
        'octocat',
      ),
    ).toBe(false);

    const snap = assembleHomeBoard({
      issues: [
        issue({
          identifier: 'ENG-1',
          title: 'Now',
          provider: 'linear',
          cycle: { name: 'Week 34', isActive: true },
        }),
        issue({
          identifier: 'ENG-2',
          title: 'Later',
          provider: 'linear',
          cycle: { name: 'Week 35', isActive: false },
        }),
      ],
      prs: [],
      threads: [],
      ticketScope: 'cycle',
    });
    expect(snap.columns.backlog.map((c) => c.kind === 'ticket' && c.identifier)).toEqual([
      'ENG-1',
    ]);
    expect(snap.columns.backlog[0]).toMatchObject({ cycle: 'Week 34' });
  });

  it('puts every worktree thread on the board, including sidebar and agent creates', () => {
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
      ['cowboy', 'sidebar'],
    );
    expect(snap.columns.queued.map((c) => c.kind === 'thread' && c.id)).toEqual(['agent']);
    expect(snap.columns.running.map((c) => c.kind === 'thread' && c.id)).toEqual([
      'adopted',
    ]);
    expect(snap.totals.threads).toBe(4);
    expect(
      [...snap.columns.queued, ...snap.columns.running, ...snap.columns.needs_you].some(
        (c) => c.kind === 'thread' && c.id === 'orch',
      ),
    ).toBe(false);
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
