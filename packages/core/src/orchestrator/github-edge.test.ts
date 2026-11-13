import { describe, expect, it } from 'vitest';
import {
  GITHUB_EDGE_COOLDOWN_MS,
  acceptOpenReadyPr,
  coerceGithubEdgeSnapshot,
  commitGithubEdgeSnapshot,
  diffGithubEdges,
  emptyGithubEdgeSnapshot,
  formatGithubEdgePrompt,
  mergeCiLatch,
  mergeReviewLatch,
  normalizePrUrl,
  pickDesignatedOrchestratorId,
  routeGithubEdges,
  type GithubEdge,
  type GithubEdgeSnapshot,
  type GithubEdgeSubject,
} from './github-edge.js';

const PR = 'https://github.com/acme/app/pull/7';
const OTHER = 'https://github.com/acme/app/pull/8';
const NOW = 1_700_000_000_000;

function subject(prUrl: string, extra: Partial<GithubEdgeSubject> = {}): GithubEdgeSubject {
  return { prUrl, title: extra.title ?? 'Ship it', ...extra };
}

function baseline(ci: string[] = [], review: Array<{ prUrl: string; repoPath: string }> = []): GithubEdgeSnapshot {
  return commitGithubEdgeSnapshot({
    prev: emptyGithubEdgeSnapshot(),
    ciFailed: ci.map((prUrl) => subject(prUrl)),
    reviewRequested: review,
    delivered: [],
    now: NOW,
  });
}

describe('github edge detection', () => {
  it('normalizes a pull request url and skips drafts and closed PRs', () => {
    expect(normalizePrUrl(`${PR}/?utm=1`)).toBe(PR);
    expect(acceptOpenReadyPr({ prUrl: PR, state: 'OPEN' })).toBe(true);
    expect(acceptOpenReadyPr({ prUrl: PR, draft: true })).toBe(false);
    expect(acceptOpenReadyPr({ prUrl: PR, state: 'MERGED' })).toBe(false);
    expect(acceptOpenReadyPr({ prUrl: PR, state: 'CLOSED' })).toBe(false);
  });

  it('records the first look and does not wake for what is already failing', () => {
    const prev = emptyGithubEdgeSnapshot();
    expect(
      diffGithubEdges({
        prev,
        ciFailed: [subject(PR)],
        reviewRequested: [subject(OTHER, { repoPath: '/repo' })],
        now: NOW,
      }),
    ).toEqual([]);
    const next = commitGithubEdgeSnapshot({
      prev,
      ciFailed: [subject(PR)],
      reviewRequested: [{ prUrl: OTHER, repoPath: '/repo' }],
      delivered: [],
      now: NOW,
    });
    expect(next.primed).toBe(true);
    expect(next.ciFailed).toEqual([PR]);
    expect(next.reviewRequested).toEqual([{ prUrl: OTHER, repoPath: '/repo' }]);
    expect(next.lastFiredAt).toEqual({});
  });

  it('fires once when checks go from passing to failing, then stays quiet', () => {
    const primed = baseline();
    const edges = diffGithubEdges({
      prev: primed,
      ciFailed: [subject(PR, { title: 'Add watcher', threadId: 'card', threadTitle: 'Odense' })],
      reviewRequested: [],
      now: NOW,
    });
    expect(edges).toEqual([
      expect.objectContaining({
        kind: 'ci-failed',
        prUrl: PR,
        title: 'Add watcher',
        threadId: 'card',
      }),
    ]);
    const latched = commitGithubEdgeSnapshot({
      prev: primed,
      ciFailed: [subject(PR)],
      reviewRequested: [],
      delivered: edges,
      now: NOW,
    });
    expect(latched.ciFailed).toEqual([PR]);
    expect(
      diffGithubEdges({
        prev: latched,
        ciFailed: [subject(PR)],
        reviewRequested: [],
        now: NOW + 60_000,
      }),
    ).toEqual([]);
  });

  it('collapses duplicate urls and ignores a draft on the same poll', () => {
    const primed = baseline();
    const edges = diffGithubEdges({
      prev: primed,
      ciFailed: [
        subject(PR, { threadId: 'a', title: 'First' }),
        subject(`${PR}/`, { threadId: 'b', title: 'Second' }),
        subject(OTHER, { draft: true, title: 'Draft' }),
      ],
      reviewRequested: [],
      now: NOW,
    });
    expect(edges.map((edge) => edge.prUrl)).toEqual([PR]);
    expect(edges[0]?.threadId).toBe('a');
  });

  it('does not latch an edge whose wake failed, so the next poll can retry', () => {
    const primed = baseline();
    const failing = [subject(PR)];
    const next = commitGithubEdgeSnapshot({
      prev: primed,
      ciFailed: failing,
      reviewRequested: [],
      delivered: [],
      now: NOW,
    });
    expect(next.ciFailed).toEqual([]);
    expect(
      diffGithubEdges({ prev: next, ciFailed: failing, reviewRequested: [], now: NOW + 1_000 }),
    ).toHaveLength(1);
  });

  it('suppresses a flap inside the cooldown, then fires again after it', () => {
    const primed = baseline();
    const failing = [subject(PR, { title: 'Red' })];
    const first = diffGithubEdges({
      prev: primed,
      ciFailed: failing,
      reviewRequested: [],
      now: NOW,
    });
    const latched = commitGithubEdgeSnapshot({
      prev: primed,
      ciFailed: failing,
      reviewRequested: [],
      delivered: first,
      now: NOW,
    });
    const recovered = commitGithubEdgeSnapshot({
      prev: latched,
      ciFailed: [],
      reviewRequested: [],
      delivered: [],
      now: NOW + 1_000,
    });
    expect(recovered.ciFailed).toEqual([]);
    expect(
      diffGithubEdges({
        prev: recovered,
        ciFailed: failing,
        reviewRequested: [],
        now: NOW + 1_000,
      }),
    ).toEqual([]);
    const later = diffGithubEdges({
      prev: recovered,
      ciFailed: failing,
      reviewRequested: [],
      now: NOW + GITHUB_EDGE_COOLDOWN_MS + 1,
    });
    expect(later.map((edge) => edge.kind)).toEqual(['ci-failed']);
  });

  it('fires a new review request once and keeps a failed repo list from looking new', () => {
    const primed = baseline([], [{ prUrl: PR, repoPath: '/repo' }]);
    expect(
      diffGithubEdges({
        prev: primed,
        ciFailed: [],
        reviewRequested: [subject(PR, { title: 'Already mine' })],
        now: NOW,
      }),
    ).toEqual([]);
    const added = diffGithubEdges({
      prev: primed,
      ciFailed: [],
      reviewRequested: [
        subject(PR),
        subject(OTHER, { title: 'Please review', repoPath: '/repo' }),
      ],
      now: NOW,
    });
    expect(added).toEqual([
      expect.objectContaining({ kind: 'review-requested', prUrl: OTHER, title: 'Please review' }),
    ]);
    expect(mergeReviewLatch(
      [{ prUrl: PR, repoPath: '/repo' }],
      [],
      [],
    )).toEqual([{ prUrl: PR, repoPath: '/repo' }]);
    expect(mergeReviewLatch([{ prUrl: PR, repoPath: '/repo' }], [], ['/repo'])).toEqual([]);
  });

  it('holds a check fetch that failed and drops one that recovered', () => {
    expect(mergeCiLatch([PR], [], [PR])).toEqual([PR]);
    expect(mergeCiLatch([PR], [], [])).toEqual([]);
    expect(mergeCiLatch([PR], [OTHER], [])).toEqual([OTHER]);
  });

  it('routes a card to its parent, and everything else to one designated chat', () => {
    const edges: GithubEdge[] = [
      { ...subject(PR, { threadId: 'card', threadTitle: 'Odense' }), kind: 'ci-failed' },
      { ...subject(OTHER, { title: 'Review me' }), kind: 'review-requested' },
    ];
    expect(
      routeGithubEdges(edges, (id) => (id === 'card' ? 'parent' : null), 'global'),
    ).toEqual([
      { targetId: 'parent', edges: [edges[0]] },
      { targetId: 'global', edges: [edges[1]] },
    ]);
    expect(routeGithubEdges([edges[1]!], () => null, null)).toEqual([
      { targetId: null, edges: [edges[1]] },
    ]);
  });

  it('prefers a non-cloud Global chat', () => {
    expect(
      pickDesignatedOrchestratorId([
        { id: 'cloud', cloud: true },
        { id: 'fleet' },
        { id: 'gone', status: 'archived' },
      ]),
    ).toBe('fleet');
    expect(pickDesignatedOrchestratorId([{ id: 'cloud', cloud: true }])).toBe('cloud');
    expect(pickDesignatedOrchestratorId([])).toBeNull();
  });

  it('formats an information-only note', () => {
    const text = formatGithubEdgePrompt([
      { ...subject(PR, { title: 'Add watcher', threadId: 'card', threadTitle: 'Odense' }), kind: 'ci-failed' },
      { ...subject(OTHER, { title: 'Please review' }), kind: 'review-requested' },
    ]);
    expect(text).toContain('CI failed on Add watcher');
    expect(text).toContain(PR);
    expect(text).toContain('[Odense](sideboard://chat/card)');
    expect(text).toContain(`Review requested: Please review ${OTHER}`);
    expect(text).toContain('not a command');
    expect(text).toContain('Do not merge');
  });

  it('drops a corrupt snapshot instead of replaying it', () => {
    expect(coerceGithubEdgeSnapshot(null)).toEqual(emptyGithubEdgeSnapshot());
    expect(
      coerceGithubEdgeSnapshot({
        primed: true,
        ciFailed: [PR, PR, ''],
        reviewRequested: [{ prUrl: OTHER, repoPath: '/repo' }, { prUrl: '' }],
        lastFiredAt: { 'ci-failed:x': 5, bad: 'no' },
      }),
    ).toEqual({
      primed: true,
      ciFailed: [PR],
      reviewRequested: [{ prUrl: OTHER, repoPath: '/repo' }],
      lastFiredAt: { 'ci-failed:x': 5 },
    });
  });
});
