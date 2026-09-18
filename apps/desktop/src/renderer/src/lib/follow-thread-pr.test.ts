import { describe, expect, it } from 'vitest';
import {
  followThreadPrMeta,
  newOpenPrSyncIds,
  sidebarPrHasKnownStatus,
  type SidebarPrMeta,
} from './follow-thread-pr';

function meta(partial: Partial<SidebarPrMeta> = {}): SidebarPrMeta {
  return {
    number: 10,
    url: 'https://github.com/acme/app/pull/10',
    state: 'OPEN',
    isDraft: true,
    title: 'Old',
    baseRefName: 'main',
    reviewDecision: null,
    isInMergeQueue: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    ...partial,
  };
}

describe('followThreadPrMeta', () => {
  it('clears cached meta when the worktree has no PR', () => {
    expect(followThreadPrMeta(meta(), { prUrl: null, prState: 'OPEN' })).toBeNull();
  });

  it('replaces cached meta when a different PR is connected', () => {
    const next = followThreadPrMeta(meta(), {
      prUrl: 'https://github.com/acme/app/pull/22',
      prState: 'OPEN',
      prIsDraft: false,
    });
    expect(next).toMatchObject({
      number: 22,
      url: 'https://github.com/acme/app/pull/22',
      state: 'OPEN',
      isDraft: false,
      reviewDecision: null,
    });
  });

  it('follows persisted lifecycle on the same PR without dropping merge fields', () => {
    const next = followThreadPrMeta(meta({ reviewDecision: 'APPROVED' }), {
      prUrl: 'https://github.com/acme/app/pull/10',
      prState: 'MERGED',
      prIsDraft: false,
    });
    expect(next).toMatchObject({
      number: 10,
      state: 'MERGED',
      isDraft: false,
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
    });
  });

  it('treats /pull/N trailing-slash URLs as the same PR', () => {
    const next = followThreadPrMeta(meta({ reviewDecision: 'APPROVED' }), {
      prUrl: 'https://github.com/acme/app/pull/10/',
      prState: 'OPEN',
      prIsDraft: true,
    });
    expect(next?.reviewDecision).toBe('APPROVED');
    expect(next?.number).toBe(10);
    expect(next?.url).toBe('https://github.com/acme/app/pull/10/');
  });

  it('does not treat a URL-only stub as a known hover status', () => {
    const stub = followThreadPrMeta(null, {
      prUrl: 'https://github.com/acme/app/pull/22',
      prState: 'OPEN',
      prIsDraft: false,
    });
    expect(sidebarPrHasKnownStatus(stub)).toBe(false);
    expect(sidebarPrHasKnownStatus(meta({ state: 'MERGED' }))).toBe(true);
    expect(sidebarPrHasKnownStatus(meta({ isDraft: true }))).toBe(true);
  });
});

describe('newOpenPrSyncIds', () => {
  it('returns every id on the first pass, then only newly added worktrees', () => {
    const seen = new Set<string>();
    expect(
      newOpenPrSyncIds('aaa:/wt/one|bbb:/wt/two', seen),
    ).toEqual(['aaa', 'bbb']);
    expect(newOpenPrSyncIds('aaa:/wt/one|bbb:/wt/two|ccc:/wt/three', seen)).toEqual([
      'ccc',
    ]);
    expect(newOpenPrSyncIds('aaa:/wt/one|bbb:/wt/two|ccc:/wt/three', seen)).toEqual(
      [],
    );
  });

  it('forgets worktrees that left the key so they can re-enter', () => {
    const seen = new Set<string>();
    newOpenPrSyncIds('aaa:/wt/one', seen);
    expect(newOpenPrSyncIds('bbb:/wt/two', seen)).toEqual(['bbb']);
    expect(seen.has('/wt/one')).toBe(false);
  });
});
