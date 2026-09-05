import { describe, expect, it } from 'vitest';
import {
  applyPrListResponse,
  buildGhPrListArgs,
  filterPrsByReviewer,
  humanReviewerLogins,
  isHumanReviewerLogin,
  normalizePrLabels,
  parseGhPrList,
  prListFetchLimit,
  prMatchesReviewer,
  resolveListPrsOptions,
  ticketRefsFromPrTitle,
} from './list-prs.js';

describe('list-prs helpers', () => {
  it('builds native gh flags for state and labels', () => {
    expect(
      buildGhPrListArgs({
        slug: 'acme/app',
        state: 'open',
        labels: ['eng-review'],
        limit: 40,
      }),
    ).toEqual([
      'pr',
      'list',
      '--json',
      expect.stringContaining('labels,reviewRequests'),
      '--limit',
      '40',
      '--state',
      'open',
      '--label',
      'eng-review',
      '--repo',
      'acme/app',
    ]);
  });

  it('uses search for reviewer=me and extra query tokens', () => {
    const args = buildGhPrListArgs({
      state: 'open',
      labels: 'eng-review',
      reviewer: 'me',
      query: 'auth',
      limit: 40,
    });
    expect(args).toContain('--search');
    expect(args.at(args.indexOf('--search') + 1)).toBe(
      'is:open label:eng-review review-requested:@me auth',
    );
    expect(args).not.toContain('--state');
  });

  it('quotes labels that contain spaces', () => {
    const args = buildGhPrListArgs({
      labels: ['needs review'],
      reviewer: 'alice',
      limit: 10,
    });
    expect(args.at(args.indexOf('--search') + 1)).toBe(
      'is:open label:"needs review" review-requested:alice',
    );
  });

  it('leaves unassigned filtering to the client', () => {
    const args = buildGhPrListArgs({
      labels: ['eng-review'],
      reviewer: 'unassigned',
      limit: 40,
    });
    expect(args).toContain('--label');
    expect(args).toContain('eng-review');
    expect(args.join(' ')).not.toMatch(/review-requested/);
    expect(prListFetchLimit(40, 'unassigned')).toBe(160);
    expect(prListFetchLimit(40, 'me')).toBe(40);
  });

  it('parses labels and treats bots as non-human reviewers', () => {
    const prs = parseGhPrList(
      JSON.stringify([
        {
          number: 12,
          title: 'Ready for review',
          headRefName: 'feat/login',
          url: 'https://github.com/acme/app/pull/12',
          isCrossRepository: false,
          author: { login: 'sam' },
          state: 'OPEN',
          isDraft: false,
          labels: [{ name: 'eng-review' }],
          reviewRequests: [
            { login: 'copilot' },
            { login: 'greptile-apps[bot]' },
            { login: 'dependabot' },
          ],
          reviewDecision: 'REVIEW_REQUIRED',
        },
        {
          number: 13,
          title: 'Has a human',
          headRefName: 'feat/pay',
          url: 'https://github.com/acme/app/pull/13',
          isCrossRepository: false,
          labels: ['eng-review'],
          reviewRequests: [{ login: 'alex' }, { login: 'copilot' }],
        },
      ]),
    );

    expect(prs[0]).toMatchObject({
      number: 12,
      labels: ['eng-review'],
      reviewRequests: ['copilot', 'greptile-apps[bot]', 'dependabot'],
    });
    expect(prs[0]?.reviewers).toBeUndefined();
    expect(prs[1]?.reviewers).toEqual(['alex']);

    expect(filterPrsByReviewer(prs, 'unassigned').map((p) => p.number)).toEqual([12]);
    expect(filterPrsByReviewer(prs, 'alex').map((p) => p.number)).toEqual([13]);
    expect(isHumanReviewerLogin('copilot-pull-request-reviewer')).toBe(false);
    expect(isHumanReviewerLogin('engineering-team')).toBe(false);
    expect(humanReviewerLogins([{ slug: 'engineering-team' }])).toEqual([]);
  });

  it('treats a team review request as unclaimed', () => {
    expect(
      prMatchesReviewer(
        {
          reviewRequests: ['engineering-team'],
          teams: ['engineering-team'],
        },
        'unassigned',
      ),
    ).toBe(true);
    expect(
      prMatchesReviewer(
        {
          reviewRequests: ['engineering-team', 'alex'],
          reviewers: ['alex'],
          teams: ['engineering-team'],
        },
        'unassigned',
      ),
    ).toBe(false);
  });

  it('keeps team-queued PRs when the viewer is on that team', () => {
    const teamOnly = {
      reviewRequests: ['engineering-team'],
      teams: ['engineering-team'],
    };
    expect(prMatchesReviewer(teamOnly, 'unassigned', ['engineering-team'])).toBe(true);
    expect(prMatchesReviewer(teamOnly, 'unassigned', ['design-team'])).toBe(false);
  });

  it('splits comma-separated labels and dedupes', () => {
    expect(normalizePrLabels('eng-review, eng-approved,eng-review')).toEqual([
      'eng-review',
      'eng-approved',
    ]);
    expect(normalizePrLabels(['eng-review', 'eng-requested-changes'])).toEqual([
      'eng-review',
      'eng-requested-changes',
    ]);
  });

  it('maps queue=review (and state=review/view) to the unclaimed inbox', () => {
    expect(resolveListPrsOptions({ queue: 'review', limit: 3 })).toEqual({
      queue: 'review',
      state: 'open',
      labels: ['eng-review'],
      reviewer: 'unassigned',
      draft: false,
      limit: 3,
    });
    expect(resolveListPrsOptions({ state: 'view' }).queue).toBe('review');
    expect(resolveListPrsOptions({ state: 'review' }).labels).toEqual(['eng-review']);
    const args = buildGhPrListArgs({
      ...resolveListPrsOptions({ queue: 'review' }),
      limit: 12,
    });
    expect(args.at(args.indexOf('--search') + 1)).toBe(
      'is:open label:eng-review draft:false',
    );
  });

  it('pulls ticket ids from PR titles for assigned work', () => {
    expect(ticketRefsFromPrTitle('ENG-12 Add login')).toEqual(['ENG-12']);
    expect(ticketRefsFromPrTitle('Fixes #44 and ENG-9')).toEqual(['#44', 'ENG-9']);
    const prs = parseGhPrList(
      JSON.stringify([
        {
          number: 8,
          title: 'ENG-4 Ready for review',
          headRefName: 'feat/a',
          url: 'https://example.com/8',
          isCrossRepository: false,
          labels: [{ name: 'eng-review' }],
          reviewRequests: [{ login: 'copilot' }],
        },
      ]),
    );
    expect(prs[0]?.tickets).toEqual(['ENG-4']);
  });

  it('queue=review drops claimed and draft PRs and honors limit', () => {
    const stdout = JSON.stringify([
      {
        number: 1,
        title: 'ENG-1 Open seat',
        headRefName: 'feat/a',
        url: 'https://example.com/1',
        isCrossRepository: false,
        isDraft: false,
        labels: [{ name: 'eng-review' }],
        reviewRequests: [
          { login: 'copilot' },
          { slug: 'engineering-team', __typename: 'Team' },
        ],
      },
      {
        number: 2,
        title: 'ENG-2 Taken',
        headRefName: 'feat/b',
        url: 'https://example.com/2',
        isCrossRepository: false,
        labels: [{ name: 'eng-review' }],
        reviewRequests: [{ login: 'pat' }],
      },
      {
        number: 3,
        title: 'ENG-3 Draft',
        headRefName: 'feat/c',
        url: 'https://example.com/3',
        isCrossRepository: false,
        isDraft: true,
        labels: [{ name: 'eng-review' }],
        reviewRequests: [],
      },
      {
        number: 4,
        title: 'ENG-4 Another open seat',
        headRefName: 'feat/d',
        url: 'https://example.com/4',
        isCrossRepository: false,
        labels: [{ name: 'eng-review' }],
      },
    ]);
    const prs = applyPrListResponse(stdout, {
      queue: 'review',
      limit: 3,
      viewerTeams: ['engineering-team'],
    });
    expect(prs.map((p) => p.number)).toEqual([1, 4]);
    expect(prs[0]?.tickets).toEqual(['ENG-1']);
    expect(prs[0]?.teams).toEqual(['engineering-team']);
  });
});
