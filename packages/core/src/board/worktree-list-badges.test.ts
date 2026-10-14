import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/thread.js';
import {
  classifyWorktreeListBadges,
  reviewLabelForRepo,
} from './worktree-list-badges.js';

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

describe('classifyWorktreeListBadges', () => {
  it('badges new and merged, and leaves a closed PR unlabeled', () => {
    expect(
      classifyWorktreeListBadges([thread({ id: 'wip', sourceType: 'ticket' })], 'matt').map(
        (badge) => badge.label,
      ),
    ).toEqual(['new']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'done',
            prUrl: 'https://github.com/acme/app/pull/10',
            prState: 'MERGED',
            prAuthorLogin: 'matt',
          }),
        ],
        'matt',
      ).map((badge) => badge.label),
    ).toEqual(['merged']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'shut',
            prUrl: 'https://github.com/acme/app/pull/11',
            prState: 'CLOSED',
            prAuthorLogin: 'matt',
          }),
        ],
        'matt',
      ),
    ).toEqual([]);
  });

  it('badges your draft, and leaves a published PR unlabeled until it is in review', () => {
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'd',
            prUrl: 'https://github.com/acme/app/pull/1',
            prState: 'OPEN',
            prIsDraft: true,
            prAuthorLogin: 'matt',
          }),
        ],
        'matt',
      ).map((badge) => badge.label),
    ).toEqual(['draft']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'mine',
            prUrl: 'https://github.com/acme/app/pull/6',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
          }),
        ],
        'matt',
        'eng-review',
      ),
    ).toEqual([]);
  });

  it('does not badge as pending before the viewer login loads', () => {
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'theirs',
            sourceType: 'pr',
            prUrl: 'https://github.com/acme/app/pull/5',
            prState: 'OPEN',
            prAuthorLogin: 'sam',
          }),
        ],
        '',
      ),
    ).toEqual([]);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'mine',
            prUrl: 'https://github.com/acme/app/pull/6',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
          }),
        ],
        '',
      ),
    ).toEqual([]);
  });

  it('shows review for someone else\'s open PR, including their drafts', () => {
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'theirs-draft',
            sourceType: 'pr',
            prUrl: 'https://github.com/acme/app/pull/9',
            prState: 'OPEN',
            prIsDraft: true,
            prAuthorLogin: 'sam',
          }),
        ],
        'matt',
      ).map((b) => b.label),
    ).toEqual(['review']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'theirs',
            sourceType: 'pr',
            prUrl: 'https://github.com/acme/app/pull/5',
            prState: 'OPEN',
            prAuthorLogin: 'sam',
            prLabels: ['eng-review'],
          }),
        ],
        'matt',
        'eng-review',
      ).map((b) => b.label),
    ).toEqual(['review']);
  });

  it('shows pending for your PR once it is in review', () => {
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'mine',
            prUrl: 'https://github.com/acme/app/pull/4',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prLabels: ['eng-review'],
          }),
        ],
        'matt',
        'eng-review',
      ).map((b) => b.label),
    ).toEqual(['pending']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'published',
            prUrl: 'https://github.com/acme/app/pull/6',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
          }),
        ],
        'matt',
      ).map((b) => b.label),
    ).toEqual(['pending']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'design',
            prUrl: 'https://github.com/acme/app/pull/12',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prLabels: ['design-review'],
          }),
        ],
        'matt',
        'design-review',
      ).map((b) => b.label),
    ).toEqual(['pending']);
  });

  it('badges an approved open PR as approved, ahead of pending and review', () => {
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'mine',
            prUrl: 'https://github.com/acme/app/pull/8',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prLabels: ['eng-review'],
            prReviewDecision: 'APPROVED',
          }),
        ],
        'matt',
        'eng-review',
      ).map((badge) => badge.label),
    ).toEqual(['approved']);
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'theirs',
            sourceType: 'pr',
            prUrl: 'https://github.com/acme/app/pull/9',
            prState: 'OPEN',
            prAuthorLogin: 'sam',
            prReviewDecision: 'APPROVED',
          }),
        ],
        'matt',
      ).map((badge) => badge.label),
    ).toEqual(['approved']);
  });

  it('marks merge conflicts with a dot on the open-PR badge', () => {
    const conflicting = classifyWorktreeListBadges(
      [
        thread({
          id: 'mine',
          prUrl: 'https://github.com/acme/app/pull/8',
          prState: 'OPEN',
          prAuthorLogin: 'matt',
          prReviewDecision: 'APPROVED',
          prMergeable: 'CONFLICTING',
        }),
      ],
      'matt',
    );
    expect(conflicting.map((badge) => badge.label)).toEqual(['approved']);
    expect(conflicting[0]).toMatchObject({
      conflict: true,
      title: 'Approved, not merged · merge conflicts',
    });
    const behind = classifyWorktreeListBadges(
      [
        thread({
          id: 'behind',
          prUrl: 'https://github.com/acme/app/pull/9',
          prState: 'OPEN',
          prAuthorLogin: 'matt',
          prMergeStateStatus: 'BEHIND',
        }),
      ],
      'matt',
    )[0];
    expect(behind?.conflict).toBeUndefined();
    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'queued',
            prUrl: 'https://github.com/acme/app/pull/10',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prMergeable: 'CONFLICTING',
            prIsInMergeQueue: true,
          }),
        ],
        'matt',
      )[0]?.conflict,
    ).toBeUndefined();
  });

  it('marks failing checks and requested changes with the same red dot', () => {
    const failing = classifyWorktreeListBadges(
      [
        thread({
          id: 'ci',
          prUrl: 'https://github.com/acme/app/pull/12',
          prState: 'OPEN',
          prAuthorLogin: 'matt',
          prReviewDecision: 'APPROVED',
          prChecksFailed: true,
          prMergeable: 'CONFLICTING',
        }),
      ],
      'matt',
    );
    expect(failing.map((badge) => badge.label)).toEqual(['approved']);
    expect(failing[0]).toMatchObject({
      conflict: true,
      title: 'Approved, not merged · checks failing · merge conflicts',
    });

    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'unstable',
            prUrl: 'https://github.com/acme/app/pull/13',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prReviewDecision: 'APPROVED',
            prMergeStateStatus: 'UNSTABLE',
          }),
        ],
        'matt',
      )[0],
    ).toMatchObject({
      id: 'approved',
      conflict: true,
      title: 'Approved, not merged · checks failing',
    });

    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'changes',
            prUrl: 'https://github.com/acme/app/pull/14',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prReviewDecision: 'CHANGES_REQUESTED',
            prLabels: ['eng-review'],
          }),
        ],
        'matt',
        'eng-review',
      )[0],
    ).toMatchObject({
      id: 'pending',
      conflict: true,
      title: 'Waiting for review · changes requested',
    });

    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'both',
            prUrl: 'https://github.com/acme/app/pull/15',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prReviewDecision: 'CHANGES_REQUESTED',
            prChecksFailed: true,
            prLabels: ['eng-review'],
          }),
        ],
        'matt',
        'eng-review',
      )[0]?.title,
    ).toBe('Waiting for review · checks failing');

    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'hidden',
            prUrl: 'https://github.com/acme/app/pull/16',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prChecksFailed: true,
            prMergeable: 'CONFLICTING',
          }),
        ],
        '',
        'eng-review',
      ),
    ).toEqual([]);

    expect(
      classifyWorktreeListBadges(
        [
          thread({
            id: 'queued',
            prUrl: 'https://github.com/acme/app/pull/17',
            prState: 'OPEN',
            prAuthorLogin: 'matt',
            prReviewDecision: 'APPROVED',
            prChecksFailed: true,
            prIsInMergeQueue: true,
          }),
        ],
        'matt',
      )[0]?.conflict,
    ).toBeUndefined();
  });

  it('does not badge cowboy worktrees', () => {
    expect(
      classifyWorktreeListBadges([thread({ id: 'cow', cowboy: true })], 'matt'),
    ).toEqual([]);
  });

  it('resolves the project ready-for-review label for a worktree path', () => {
    expect(
      reviewLabelForRepo(
        { '/Users/me/app': 'eng-review' },
        '/Users/me/app/worktrees/ajax',
      ),
    ).toBe('eng-review');
    expect(reviewLabelForRepo({ '/Users/me/app': 'eng-review' }, '/Users/me/other')).toBe(
      '',
    );
  });
});
