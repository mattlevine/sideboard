import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveCreateMatchThread } from '../board/home-board.js';
import { listPhoneSidebar } from './phone-chats.js';
import {
  phoneReviewPrFields,
  refreshPhoneReviewPrs,
  resetPhoneReviewPrSnapshot,
  type PhoneReviewPrDeps,
} from './phone-review-prs.js';

function thread(patch: Partial<LiveCreateMatchThread> = {}): LiveCreateMatchThread {
  return {
    id: 'chat-1',
    status: 'idle',
    sourceType: 'pr',
    sourceRef: '12',
    title: 'Fix',
    prUrl: 'https://github.com/acme/app/pull/12',
    branchName: 'fix',
    repoPath: '/tmp/sideboard',
    cowboy: false,
    ...patch,
  };
}

function deps(patch: Partial<PhoneReviewPrDeps> = {}): PhoneReviewPrDeps {
  return {
    repos: () => [{ path: '/tmp/sideboard', name: 'sideboard' }],
    threads: () => [],
    listMine: async () => [],
    ...patch,
  };
}

describe('phone review prs', () => {
  let dataDir: string;

  afterEach(() => {
    resetPhoneReviewPrSnapshot();
    vi.unstubAllEnvs();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('stays off the sidebar until the first poll finishes', () => {
    expect(phoneReviewPrFields()).toEqual({});
  });

  it('lists review-requested PRs and points a row at the live workspace', async () => {
    const snap = await refreshPhoneReviewPrs(
      deps({
        threads: () => [thread()],
        listMine: async () => [
          {
            number: 12,
            title: 'Fix login',
            url: 'https://github.com/acme/app/pull/12',
            headRefName: 'fix',
            isDraft: false,
          },
          {
            number: 9,
            title: 'Still drafting',
            url: 'https://github.com/acme/app/pull/9',
            headRefName: 'draft',
            isDraft: true,
          },
          {
            number: 15,
            title: 'Needs a checkout',
            url: 'https://github.com/acme/app/pull/15',
            headRefName: 'new',
            isDraft: false,
          },
        ],
      }),
    );
    expect(snap.error).toBeUndefined();
    expect(snap.ready).toBe(true);
    expect(snap.prs.map((pr) => pr.number)).toEqual([15, 12]);
    expect(snap.prs.find((pr) => pr.number === 12)).toMatchObject({
      chatId: 'chat-1',
      repoName: 'sideboard',
      title: 'Fix login',
    });
    expect(snap.prs.find((pr) => pr.number === 15)?.chatId).toBeUndefined();
    expect(phoneReviewPrFields()).toEqual({ reviews: snap.prs, reviewsReady: true });
  });

  it('reports an empty inbox when GitHub has nothing waiting', async () => {
    const snap = await refreshPhoneReviewPrs(deps());
    expect(snap).toEqual({ prs: [], ready: true });
    expect(phoneReviewPrFields()).toEqual({ reviews: [], reviewsReady: true });
  });

  it('keeps successful repos when one project fails to list', async () => {
    const snap = await refreshPhoneReviewPrs(
      deps({
        repos: () => [
          { path: '/tmp/sideboard', name: 'sideboard' },
          { path: '/tmp/other', name: 'other' },
        ],
        listMine: async (repoPath) => {
          if (repoPath.endsWith('other')) throw new Error('gh pr list failed');
          return [
            {
              number: 4,
              title: 'Auth',
              url: 'https://github.com/acme/app/pull/4',
              headRefName: 'auth',
              isDraft: false,
            },
          ];
        },
      }),
    );
    expect(snap.prs.map((pr) => pr.number)).toEqual([4]);
    expect(snap.error).toBe("Couldn't load reviews for other.");
    expect(snap.ready).toBe(true);
  });

  it('surfaces an error when every project fails', async () => {
    const snap = await refreshPhoneReviewPrs(
      deps({
        listMine: async () => {
          throw new Error('gh down');
        },
      }),
    );
    expect(snap.prs).toEqual([]);
    expect(snap.ready).toBe(true);
    expect(snap.error).toBe("Couldn't load pull requests waiting on your review.");
    expect(phoneReviewPrFields().reviewsError).toBe(snap.error);
  });

  it('joins the phone sidebar the list already sends', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-phone-reviews-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    await refreshPhoneReviewPrs(
      deps({
        listMine: async () => [
          {
            number: 8,
            title: 'Please review',
            url: 'https://github.com/acme/app/pull/8',
            headRefName: 'review',
            isDraft: false,
          },
        ],
      }),
    );
    expect(listPhoneSidebar().reviews).toMatchObject([
      { number: 8, title: 'Please review', repoName: 'sideboard' },
    ]);
    expect(listPhoneSidebar().reviewsReady).toBe(true);
    expect(listPhoneSidebar().reviews?.[0]?.chatId).toBeUndefined();
  });
});
