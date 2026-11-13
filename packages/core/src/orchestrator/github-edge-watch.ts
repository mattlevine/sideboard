import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ciChecksFailed } from '../git/pr-gates.js';
import { threadPrChecksFailedPatch } from '../git/pr-merge-archive.js';
import { getPrCiChecks, listPrs } from '../git/worktree.js';
import { isThisProcessDesktopHost } from '../store/desktop-host.js';
import {
  loadAppSettings,
  resolveOrchestratorDefaults,
  resolveProjectReviewLabel,
  wakeOrchestratorOnGithubEdgesEnabled,
} from '../store/app-settings.js';
import { isCloudCoordinatorThread, isGlobalThread, isOrchestratorThread, listGlobalThreads } from '../store/global-workspace.js';
import { appDataDir } from '../store/paths.js';
import { writePrivateFile } from '../store/private-file.js';
import { listThreads, readThread, updateThread } from '../store/thread-store.js';
import { threadsSharingWorktree } from '../threads/chat-tabs.js';
import { connectedOrchestrator } from '../threads/connected-orchestrator.js';
import type { Thread } from '../types/thread.js';
import {
  GITHUB_EDGE_POLL_MS,
  acceptOpenReadyPr,
  coerceGithubEdgeSnapshot,
  commitGithubEdgeSnapshot,
  diffGithubEdges,
  emptyGithubEdgeSnapshot,
  formatGithubEdgePrompt,
  githubEdgeSnapshotKey,
  mergeCiLatch,
  mergeReviewLatch,
  normalizePrUrl,
  pickDesignatedOrchestratorId,
  routeGithubEdges,
  type GithubEdge,
  type GithubEdgeReviewLatch,
  type GithubEdgeSnapshot,
  type GithubEdgeSubject,
} from './github-edge.js';

export interface GithubEdgeCiCard {
  threadId: string;
  threadTitle: string;
  worktreePath: string;
  repoPath: string;
  prUrl: string;
  prTitle: string;
  draft?: boolean;
  state?: string | null;
}

export interface GithubEdgeReviewRow {
  prUrl: string;
  title: string;
  draft?: boolean;
  state?: string | null;
}

export interface GithubEdgeWatchDeps {
  enabled(): boolean;
  listCiCards(): GithubEdgeCiCard[];
  /** `null` means the fetch failed — keep the previous latch for that PR. */
  fetchCiFailed(card: GithubEdgeCiCard): Promise<boolean | null>;
  listRepoPaths(): string[];
  /** `null` means this repo's list failed. */
  listReviewRequested(repoPath: string): Promise<GithubEdgeReviewRow[] | null>;
  parentIdForThread(threadId: string): string | null;
  designatedId(): string | null;
  send(threadId: string, prompt: string): Promise<void>;
  startOrchestration(prompt: string): Promise<void>;
  load(): GithubEdgeSnapshot;
  save(snapshot: GithubEdgeSnapshot): void;
  now(): number;
}

export interface GithubEdgePollResult {
  fired: number;
  primed: boolean;
  skipped?: 'disabled';
}

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;
/** The first poll after this process arms the watcher only records current state. */
let needsBaseline = true;

export function githubEdgeSnapshotPath(): string {
  return join(appDataDir(), 'github-edge-watch.json');
}

export function loadGithubEdgeSnapshot(): GithubEdgeSnapshot {
  try {
    const path = githubEdgeSnapshotPath();
    if (!existsSync(path)) return emptyGithubEdgeSnapshot();
    return coerceGithubEdgeSnapshot(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return emptyGithubEdgeSnapshot();
  }
}

export function saveGithubEdgeSnapshot(snapshot: GithubEdgeSnapshot): void {
  writePrivateFile(githubEdgeSnapshotPath(), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function stopGithubEdgeWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test hook. Does not clear the on-disk snapshot. */
export function resetGithubEdgeWatchForTests(): void {
  stopGithubEdgeWatch();
  polling = false;
  needsBaseline = true;
}

/**
 * Arm the host poller. No-ops unless this process owns the desktop host and
 * Settings → Advanced → Wake orchestrator on CI / review-requested is on.
 * Safe to call often: a running timer stays, and turning the setting off stops it.
 */
export function armGithubEdgeWatch(): void {
  if (!isThisProcessDesktopHost()) return;
  if (!wakeOrchestratorOnGithubEdgesEnabled()) {
    stopGithubEdgeWatch();
    needsBaseline = true;
    return;
  }
  if (timer) return;
  const tick = () => {
    if (polling) return;
    polling = true;
    const baseline = needsBaseline;
    needsBaseline = false;
    void pollGithubEdges(realDeps(), { baseline })
      .catch(() => {
        // Keep the next tick as a baseline when this look failed entirely.
        if (baseline) needsBaseline = true;
        // The next tick retries. A failed poll does not clear latches.
      })
      .finally(() => {
        polling = false;
      });
  };
  timer = setInterval(tick, GITHUB_EDGE_POLL_MS);
  timer.unref?.();
  tick();
}

export async function pollGithubEdges(
  deps: GithubEdgeWatchDeps = realDeps(),
  opts?: { baseline?: boolean },
): Promise<GithubEdgePollResult> {
  if (!deps.enabled()) return { fired: 0, primed: false, skipped: 'disabled' };
  const loaded = deps.load();
  // A fresh arm records whatever is already true and keeps cooldown timestamps.
  const prev = opts?.baseline ? { ...loaded, primed: false } : loaded;
  const now = deps.now();
  const cards = indexCiCards(deps.listCiCards(), (threadId) => deps.parentIdForThread(threadId));
  const failing: string[] = [];
  const unknown: string[] = [];
  const failingSubjects = new Map<string, GithubEdgeSubject>();
  for (const card of cards.values()) {
    const prUrl = normalizePrUrl(card.prUrl);
    let failed: boolean | null;
    try {
      failed = await deps.fetchCiFailed(card);
    } catch {
      failed = null;
    }
    if (failed == null) {
      unknown.push(prUrl);
      continue;
    }
    if (!failed) continue;
    failing.push(prUrl);
    failingSubjects.set(prUrl, subjectFromCard(card, prUrl));
  }
  // A baseline read that failed still counts as "already red" so the next
  // success does not wake. A later green read drops that latch.
  const ciUrls = mergeCiLatch(
    prev.ciFailed,
    prev.primed ? failing : [...failing, ...unknown],
    unknown,
  );
  const ciFailed = ciUrls.map(
    (prUrl) => failingSubjects.get(prUrl) ?? { prUrl, title: prUrl },
  );

  const repos = [...new Set(deps.listRepoPaths().map((path) => path.trim()).filter(Boolean))].sort();
  const fetchedReviews: GithubEdgeReviewLatch[] = [];
  const reviewSubjects = new Map<string, GithubEdgeSubject>();
  const successfulRepos: string[] = [];
  for (const repoPath of repos) {
    let rows: GithubEdgeReviewRow[] | null;
    try {
      rows = await deps.listReviewRequested(repoPath);
    } catch {
      rows = null;
    }
    if (!rows) continue;
    successfulRepos.push(repoPath);
    for (const row of rows) {
      if (!acceptOpenReadyPr(row)) continue;
      const prUrl = normalizePrUrl(row.prUrl);
      if (!prUrl) continue;
      const card = cards.get(prUrl);
      fetchedReviews.push({ prUrl, repoPath });
      reviewSubjects.set(prUrl, {
        prUrl,
        title: row.title.trim() || card?.prTitle || prUrl,
        threadId: card?.threadId,
        threadTitle: card?.threadTitle,
        repoPath,
      });
    }
  }
  const seenRepos = new Set(prev.reviewReposSeen ?? []);
  const freshRepos = new Set(
    prev.primed ? successfulRepos.filter((repo) => !seenRepos.has(repo)) : [],
  );
  const reviewLatch = repos.length
    ? mergeReviewLatch(prev.reviewRequested, fetchedReviews, successfulRepos)
    : prev.reviewRequested;
  const reviewRequested = reviewLatch
    .filter((row) => !freshRepos.has(row.repoPath))
    .map(
      (row) =>
        reviewSubjects.get(row.prUrl) ?? {
          prUrl: row.prUrl,
          title: row.prUrl,
          repoPath: row.repoPath,
        },
    );
  const baseline = reviewLatch.filter((row) => freshRepos.has(row.repoPath));
  const edges = diffGithubEdges({ prev, ciFailed, reviewRequested, now });
  const delivered = prev.primed && edges.length ? await deliverGithubEdges(edges, deps) : [];
  const committed = commitGithubEdgeSnapshot({
    prev: baseline.length
      ? { ...prev, reviewRequested: mergeReviewLatch(prev.reviewRequested, baseline, [...freshRepos]) }
      : prev,
    ciFailed,
    reviewRequested: reviewLatch,
    delivered,
    now,
  });
  const watched = new Set(repos);
  const reviewReposSeen = [
    ...new Set([
      ...(prev.reviewReposSeen ?? []).filter((repo) => watched.has(repo)),
      ...successfulRepos,
    ]),
  ].sort();
  const next = reviewReposSeen.length ? { ...committed, reviewReposSeen } : committed;
  if (githubEdgeSnapshotKey(prev) !== githubEdgeSnapshotKey(next)) deps.save(next);
  return { fired: delivered.length, primed: next.primed };
}

async function deliverGithubEdges(
  edges: GithubEdge[],
  deps: GithubEdgeWatchDeps,
): Promise<GithubEdge[]> {
  const delivered: GithubEdge[] = [];
  for (const group of routeGithubEdges(edges, (threadId) => deps.parentIdForThread(threadId), deps.designatedId())) {
    const prompt = formatGithubEdgePrompt(group.edges);
    try {
      if (group.targetId) await deps.send(group.targetId, prompt);
      else await deps.startOrchestration(prompt);
      delivered.push(...group.edges);
    } catch {
      // Leave this group unlatched so the next poll retries it.
    }
  }
  return delivered;
}

function indexCiCards(
  cards: GithubEdgeCiCard[],
  parentIdForThread: (threadId: string) => string | null,
): Map<string, GithubEdgeCiCard> {
  const byUrl = new Map<string, GithubEdgeCiCard>();
  for (const card of cards) {
    if (!acceptOpenReadyPr(card)) continue;
    const prUrl = normalizePrUrl(card.prUrl);
    if (!prUrl) continue;
    const existing = byUrl.get(prUrl);
    if (!existing) {
      byUrl.set(prUrl, card);
      continue;
    }
    const existingParent = parentIdForThread(existing.threadId);
    const nextParent = parentIdForThread(card.threadId);
    if (!existingParent && nextParent) byUrl.set(prUrl, card);
  }
  return byUrl;
}

function subjectFromCard(card: GithubEdgeCiCard, prUrl: string): GithubEdgeSubject {
  return {
    prUrl,
    title: card.prTitle.trim() || card.threadTitle.trim() || prUrl,
    threadId: card.threadId,
    threadTitle: card.threadTitle,
    repoPath: card.repoPath,
    draft: card.draft,
    state: card.state,
  };
}

function liveWorktreeThreads(): Thread[] {
  return listThreads().filter(
    (thread) =>
      !isGlobalThread(thread) &&
      !isOrchestratorThread(thread) &&
      thread.wakeOnGithubEdges === true &&
      Boolean(thread.worktreePath?.trim()) &&
      Boolean(thread.repoPath?.trim()),
  );
}

function listCiCardsFromStore(): GithubEdgeCiCard[] {
  const cards: GithubEdgeCiCard[] = [];
  for (const thread of liveWorktreeThreads()) {
    const prUrl = thread.prUrl?.trim() ?? '';
    if (!prUrl) continue;
    cards.push({
      threadId: thread.id,
      threadTitle: thread.title?.trim() || 'Workspace',
      worktreePath: thread.worktreePath,
      repoPath: thread.repoPath,
      prUrl,
      prTitle: thread.prTitle?.trim() || thread.title?.trim() || prUrl,
      draft: thread.prIsDraft,
      state: thread.prState,
    });
  }
  return cards;
}

function listLiveRepoPaths(): string[] {
  return [...new Set(liveWorktreeThreads().map((thread) => thread.repoPath.trim()).filter(Boolean))];
}

async function fetchCiFailedFromGh(card: GithubEdgeCiCard): Promise<boolean | null> {
  try {
    const checks = await getPrCiChecks(card.worktreePath, card.prUrl);
    if (!checks) return null;
    const failed = ciChecksFailed(checks);
    persistChecksFailed(card, failed);
    return failed;
  } catch {
    return null;
  }
}

function persistChecksFailed(card: GithubEdgeCiCard, failed: boolean): void {
  const siblings = threadsSharingWorktree(card.worktreePath);
  const self = readThread(card.threadId);
  const targets = siblings.length > 0 ? siblings : self ? [self] : [];
  for (const thread of targets) {
    const patch = threadPrChecksFailedPatch(thread, failed);
    if (Object.keys(patch).length === 0) continue;
    try {
      updateThread(thread.id, patch);
    } catch {
      // The edge still wakes from this poll's own snapshot.
    }
  }
}

async function listMineFromGh(repoPath: string): Promise<GithubEdgeReviewRow[] | null> {
  try {
    const reviewLabel = resolveProjectReviewLabel(loadAppSettings(), repoPath);
    const rows = await listPrs(repoPath, {
      queue: 'mine',
      limit: 30,
      ...(reviewLabel ? { reviewLabel } : {}),
    });
    return rows.map((row) => ({
      prUrl: row.url,
      title: row.title,
      draft: row.isDraft,
      state: row.state,
    }));
  } catch {
    return null;
  }
}

function parentIdForThread(threadId: string): string | null {
  const thread = readThread(threadId);
  if (!thread || thread.status === 'archived') return null;
  const parent = connectedOrchestrator(thread, (id) => readThread(id));
  if (!parent || parent.status === 'archived') return null;
  return parent.id;
}

function designatedOrchestratorId(): string | null {
  return pickDesignatedOrchestratorId(
    listGlobalThreads().map((thread) => ({
      id: thread.id,
      status: thread.status,
      cloud: isCloudCoordinatorThread(thread),
    })),
  );
}

function realDeps(): GithubEdgeWatchDeps {
  return {
    enabled: () => wakeOrchestratorOnGithubEdgesEnabled(),
    listCiCards: listCiCardsFromStore,
    fetchCiFailed: fetchCiFailedFromGh,
    listRepoPaths: listLiveRepoPaths,
    listReviewRequested: listMineFromGh,
    parentIdForThread,
    designatedId: designatedOrchestratorId,
    send: async (threadId, prompt) => {
      const { getOrchestrator } = await import('./orchestrator.js');
      await getOrchestrator().send(threadId, prompt, { followUp: 'queue' });
    },
    startOrchestration: async (prompt) => {
      const { startOrchestration } = await import('./orchestrator.js');
      const defaults = resolveOrchestratorDefaults();
      await startOrchestration({
        goal: prompt,
        agent: defaults.agent,
        model: defaults.model,
        effort: defaults.effort,
        fast: defaults.fast,
        autonomy: defaults.autonomy,
      });
    },
    load: loadGithubEdgeSnapshot,
    save: saveGithubEdgeSnapshot,
    now: () => Date.now(),
  };
}
