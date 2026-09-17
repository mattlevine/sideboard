import { describe, expect, it } from 'vitest';
import {
  normalizePrState,
  shouldAutoArchiveOnPrMerge,
  shouldPersistFetchedPrMeta,
  threadPrMetaPatch,
} from './pr-merge-archive.js';

describe('normalizePrState', () => {
  it('uppercases and trims', () => {
    expect(normalizePrState(' merged ')).toBe('MERGED');
    expect(normalizePrState(null)).toBe('');
  });
});

describe('shouldAutoArchiveOnPrMerge', () => {
  const base = {
    previousPrState: 'OPEN' as string | null,
    nextPrState: 'MERGED',
    threadStatus: 'idle' as const,
    autoArchiveEnabled: true,
    isGlobal: false,
  };

  it('archives on first transition to MERGED', () => {
    expect(shouldAutoArchiveOnPrMerge(base)).toBe(true);
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, previousPrState: null }),
    ).toBe(true);
  });

  it('does not re-archive when already MERGED', () => {
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, previousPrState: 'MERGED' }),
    ).toBe(false);
  });

  it('respects restore skip flag (Conductor unarchive guard)', () => {
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, skipAutoArchiveOnMerge: true }),
    ).toBe(false);
  });

  it('respects setting off, archived, and global', () => {
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, autoArchiveEnabled: false }),
    ).toBe(false);
    expect(
      shouldAutoArchiveOnPrMerge({ ...base, threadStatus: 'archived' }),
    ).toBe(false);
    expect(shouldAutoArchiveOnPrMerge({ ...base, isGlobal: true })).toBe(false);
  });
});

describe('threadPrMetaPatch', () => {
  const base = {
    prUrl: 'https://github.com/acme/app/pull/9',
    prTitle: 'Old',
    prState: 'OPEN',
    prIsDraft: true,
    prAuthorLogin: 'sam',
    prReviewerLogins: ['matt'],
    skipAutoArchiveOnMerge: false,
  };

  it('follows a newly connected PR URL and lifecycle', () => {
    expect(
      threadPrMetaPatch(base, {
        url: 'https://github.com/acme/app/pull/22',
        title: 'New work',
        state: 'OPEN',
        isDraft: false,
        authorLogin: 'sam',
        reviewerLogins: ['matt'],
      }),
    ).toEqual({
      prUrl: 'https://github.com/acme/app/pull/22',
      prTitle: 'New work',
      prIsDraft: false,
    });
  });

  it('clears the restore skip flag when the PR is open again', () => {
    expect(
      threadPrMetaPatch(
        { ...base, skipAutoArchiveOnMerge: true, prState: 'MERGED' },
        {
          url: base.prUrl,
          title: base.prTitle,
          state: 'OPEN',
          isDraft: true,
          authorLogin: 'sam',
          reviewerLogins: ['matt'],
        },
      ),
    ).toMatchObject({
      prState: 'OPEN',
      skipAutoArchiveOnMerge: false,
    });
  });
});

describe('shouldPersistFetchedPrMeta', () => {
  it('persists only the current-head PR when head lookup succeeded', () => {
    expect(
      shouldPersistFetchedPrMeta({
        metaUrl: 'https://github.com/acme/app/pull/9',
        livePrUrl: 'https://github.com/acme/app/pull/22',
        headPrUrl: 'https://github.com/acme/app/pull/22',
      }),
    ).toBe(false);
    expect(
      shouldPersistFetchedPrMeta({
        metaUrl: 'https://github.com/acme/app/pull/22/',
        livePrUrl: 'https://github.com/acme/app/pull/9',
        headPrUrl: 'https://github.com/acme/app/pull/22',
      }),
    ).toBe(true);
  });

  it('does not persist a fallback selector that disagrees with live prUrl', () => {
    expect(
      shouldPersistFetchedPrMeta({
        metaUrl: 'https://github.com/acme/app/pull/9',
        livePrUrl: 'https://github.com/acme/app/pull/22',
        headPrUrl: null,
      }),
    ).toBe(false);
  });

  it('allows first discovery when nothing is persisted yet', () => {
    expect(
      shouldPersistFetchedPrMeta({
        metaUrl: 'https://github.com/acme/app/pull/22',
        livePrUrl: null,
        headPrUrl: null,
      }),
    ).toBe(true);
  });
});
