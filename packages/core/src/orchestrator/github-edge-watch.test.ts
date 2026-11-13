import { describe, expect, it } from 'vitest';
import { GITHUB_EDGE_COOLDOWN_MS } from './github-edge.js';
import {
  pollGithubEdges,
  type GithubEdgeCiCard,
  type GithubEdgeReviewRow,
  type GithubEdgeWatchDeps,
} from './github-edge-watch.js';
import { emptyGithubEdgeSnapshot, type GithubEdgeSnapshot } from './github-edge.js';

const PR = 'https://github.com/acme/app/pull/7';
const OTHER = 'https://github.com/acme/app/pull/9';

function card(prUrl: string, extra: Partial<GithubEdgeCiCard> = {}): GithubEdgeCiCard {
  return {
    threadId: extra.threadId ?? 'card',
    threadTitle: extra.threadTitle ?? 'Odense',
    worktreePath: '/wt',
    repoPath: '/repo',
    prUrl,
    prTitle: extra.prTitle ?? 'Add watcher',
    draft: extra.draft,
    state: extra.state ?? 'OPEN',
  };
}

function harness(init?: {
  cards?: GithubEdgeCiCard[];
  failed?: Map<string, boolean | null>;
  reviews?: Map<string, GithubEdgeReviewRow[] | null>;
  parents?: Map<string, string | null>;
  designated?: string | null;
}) {
  let snap: GithubEdgeSnapshot = emptyGithubEdgeSnapshot();
  let now = 1_700_000_000_000;
  let enabled = true;
  let failSend = false;
  const cards = init?.cards ?? [];
  const failed = init?.failed ?? new Map<string, boolean | null>();
  const reviews = init?.reviews ?? new Map<string, GithubEdgeReviewRow[] | null>([['/repo', []]]);
  const parents = init?.parents ?? new Map<string, string | null>([['card', 'parent']]);
  let designated = init?.designated === undefined ? 'global' : init.designated;
  const fetches: string[] = [];
  const reviewFetches: string[] = [];
  const sends: Array<{ id: string; prompt: string }> = [];
  const created: string[] = [];
  const deps: GithubEdgeWatchDeps = {
    enabled: () => enabled,
    listCiCards: () => cards,
    fetchCiFailed: async (row) => {
      fetches.push(row.prUrl);
      return failed.has(row.prUrl) ? failed.get(row.prUrl)! : false;
    },
    listRepoPaths: () => [...reviews.keys()],
    listReviewRequested: async (repoPath) => {
      reviewFetches.push(repoPath);
      return reviews.has(repoPath) ? reviews.get(repoPath)! : [];
    },
    parentIdForThread: (threadId) => parents.get(threadId) ?? null,
    designatedId: () => designated,
    send: async (id, prompt) => {
      if (failSend) throw new Error('queue down');
      sends.push({ id, prompt });
    },
    startOrchestration: async (prompt) => {
      if (failSend) throw new Error('queue down');
      created.push(prompt);
    },
    load: () => snap,
    save: (next) => {
      snap = next;
    },
    now: () => now,
  };
  return {
    deps,
    fetches,
    reviewFetches,
    sends,
    created,
    snapshot: () => snap,
    setNow: (value: number) => {
      now = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setFailSend: (value: boolean) => {
      failSend = value;
    },
    setDesignated: (value: string | null) => {
      designated = value;
    },
    cards,
    failed,
    reviews,
    parents,
  };
}

describe('github edge watch', () => {
  it('does not poll when the setting is off', async () => {
    const env = harness();
    env.setEnabled(false);
    env.cards.push(card(PR));
    env.failed.set(PR, true);
    const result = await pollGithubEdges(env.deps);
    expect(result.skipped).toBe('disabled');
    expect(env.fetches).toEqual([]);
    expect(env.sends).toEqual([]);
  });

  it('baselines a failing check, then wakes the parent once', async () => {
    const env = harness();
    env.cards.push(card(PR));
    env.failed.set(PR, true);
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    expect(env.sends).toEqual([]);
    expect(env.snapshot().ciFailed).toEqual([PR]);

    expect((await pollGithubEdges(env.deps)).fired).toBe(0);

    env.failed.set(PR, false);
    await pollGithubEdges(env.deps);
    env.failed.set(PR, true);
    expect((await pollGithubEdges(env.deps)).fired).toBe(1);
    expect(env.sends).toHaveLength(1);
    expect(env.sends[0]?.id).toBe('parent');
    expect(env.sends[0]?.prompt).toContain('CI failed on Add watcher');
    expect(env.sends[0]?.prompt).toContain(PR);
    expect(env.sends[0]?.prompt).toContain('not a command');

    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    expect(env.sends).toHaveLength(1);
  });

  it('skips drafts and fetches one shared pull request once', async () => {
    const env = harness();
    env.cards.push(card(PR, { draft: true, threadId: 'draft' }));
    env.cards.push(card(PR, { threadId: 'no-parent' }));
    env.cards.push(card(PR, { threadId: 'card' }));
    env.parents.set('no-parent', null);
    env.parents.set('card', 'parent');
    await pollGithubEdges(env.deps);
    expect(env.fetches).toEqual([PR]);
    env.failed.set(PR, true);
    await pollGithubEdges(env.deps);
    expect(env.sends).toHaveLength(1);
    expect(env.sends[0]?.id).toBe('parent');
    expect(env.fetches).toEqual([PR, PR]);
  });

  it('retries a wake that failed to queue and does not retry a cooldown flap', async () => {
    const env = harness();
    env.cards.push(card(PR));
    await pollGithubEdges(env.deps);
    env.failed.set(PR, true);
    env.setFailSend(true);
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    expect(env.snapshot().ciFailed).toEqual([]);
    env.setFailSend(false);
    expect((await pollGithubEdges(env.deps)).fired).toBe(1);

    env.failed.set(PR, false);
    await pollGithubEdges(env.deps);
    env.failed.set(PR, true);
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    env.advance(GITHUB_EDGE_COOLDOWN_MS + 1);
    expect((await pollGithubEdges(env.deps)).fired).toBe(1);
    expect(env.sends).toHaveLength(2);
  });

  it('wakes once for a new review request and ignores drafts', async () => {
    const env = harness();
    env.reviews.set('/repo', [
      { prUrl: OTHER, title: 'Please review', draft: true },
    ]);
    await pollGithubEdges(env.deps);
    env.reviews.set('/repo', [
      { prUrl: OTHER, title: 'Please review', draft: false, state: 'OPEN' },
    ]);
    expect((await pollGithubEdges(env.deps)).fired).toBe(1);
    expect(env.sends[0]?.id).toBe('global');
    expect(env.sends[0]?.prompt).toContain('Review requested: Please review');
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);

    env.reviews.set('/repo', null);
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    expect(env.snapshot().reviewRequested).toEqual([{ prUrl: OTHER, repoPath: '/repo' }]);
  });

  it('opens one Global chat when nothing is designated', async () => {
    const env = harness({ designated: null });
    env.parents.set('card', null);
    await pollGithubEdges(env.deps);
    env.failed.set(PR, true);
    env.cards.push(card(PR));
    env.reviews.set('/repo', [{ prUrl: OTHER, title: 'Please review', state: 'OPEN' }]);
    expect((await pollGithubEdges(env.deps)).fired).toBe(2);
    expect(env.sends).toEqual([]);
    expect(env.created).toHaveLength(1);
    expect(env.created[0]).toContain('CI failed on Add watcher');
    expect(env.created[0]).toContain('Review requested: Please review');
  });

  it('records current failures on a fresh baseline instead of replaying them', async () => {
    const env = harness();
    env.cards.push(card(PR));
    env.failed.set(PR, true);
    await pollGithubEdges(env.deps);
    env.cards.push(card(OTHER, { threadId: 'other', prTitle: 'Also red' }));
    env.failed.set(OTHER, true);
    expect((await pollGithubEdges(env.deps, { baseline: true })).fired).toBe(0);
    expect(env.sends).toEqual([]);
    expect(env.snapshot().ciFailed.sort()).toEqual([OTHER, PR].sort());
  });

  it('keeps a latched failure when the check fetch fails', async () => {
    const env = harness();
    env.cards.push(card(PR));
    env.failed.set(PR, true);
    await pollGithubEdges(env.deps);
    env.failed.set(PR, null);
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    expect(env.snapshot().ciFailed).toEqual([PR]);
    expect(env.sends).toEqual([]);
  });

  it('records a newly watched repo before waking on a later review', async () => {
    const env = harness();
    await pollGithubEdges(env.deps);
    env.reviews.set('/other', [
      { prUrl: OTHER, title: 'Already waiting', draft: false, state: 'OPEN' },
    ]);
    expect((await pollGithubEdges(env.deps)).fired).toBe(0);
    expect(env.sends).toEqual([]);
    env.reviews.set('/other', [
      { prUrl: OTHER, title: 'Already waiting', draft: false, state: 'OPEN' },
      { prUrl: PR, title: 'New ask', draft: false, state: 'OPEN' },
    ]);
    expect((await pollGithubEdges(env.deps)).fired).toBe(1);
    expect(env.sends[0]?.prompt).toContain('Review requested: New ask');
  });
});
