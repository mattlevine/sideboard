import { describe, expect, it } from 'vitest';
import type { Thread } from '@sideboard-ai/core';
import {
  backlogIssues,
  boardIssueKey,
  classifyThreadColumn,
  dedupeBoardIssues,
  issueNeedsWorkspacePick,
  pickDefaultRepoPath,
  threadMatchesIssue,
  type BoardIssue,
} from './home-board';

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
  };
}

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
