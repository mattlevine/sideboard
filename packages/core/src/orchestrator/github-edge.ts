/**
 * Local GitHub edges for the desktop host.
 *
 * The first observation after launch (or after the setting is turned on) only
 * records what is already true. Later polls wake on a new failing check or a
 * new review request. The same edge does not fire again until it clears and
 * returns, and a return inside the cooldown stays quiet.
 */

export const GITHUB_EDGE_COOLDOWN_MS = 30 * 60_000;
export const GITHUB_EDGE_POLL_MS = 60_000;
const LAST_FIRED_KEEP_MS = 7 * 24 * 60 * 60_000;

export type GithubEdgeKind = 'ci-failed' | 'review-requested';

export interface GithubEdgeSubject {
  prUrl: string;
  title: string;
  threadId?: string;
  threadTitle?: string;
  repoPath?: string;
  draft?: boolean;
  state?: string | null;
}

export interface GithubEdge extends GithubEdgeSubject {
  kind: GithubEdgeKind;
}

export interface GithubEdgeReviewLatch {
  prUrl: string;
  repoPath: string;
}

export interface GithubEdgeSnapshot {
  primed: boolean;
  ciFailed: string[];
  reviewRequested: GithubEdgeReviewLatch[];
  /** Epoch ms, keyed by `ci-failed:url` or `review-requested:url`. */
  lastFiredAt: Record<string, number>;
  /** Repos whose review queue has already been recorded. */
  reviewReposSeen?: string[];
}

export interface GithubEdgeWake {
  /** Null opens a Global orchestration chat. */
  targetId: string | null;
  edges: GithubEdge[];
}

export function emptyGithubEdgeSnapshot(): GithubEdgeSnapshot {
  return { primed: false, ciFailed: [], reviewRequested: [], lastFiredAt: {} };
}

export function normalizePrUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function githubEdgeKey(kind: GithubEdgeKind, prUrl: string): string {
  return `${kind}:${normalizePrUrl(prUrl)}`;
}

/** Open, non-draft pull requests. Unknown state still counts as open. */
export function acceptOpenReadyPr(row: {
  prUrl?: string | null;
  draft?: boolean;
  state?: string | null;
}): boolean {
  if (!normalizePrUrl(row.prUrl)) return false;
  if (row.draft === true) return false;
  const state = (row.state ?? '').trim().toUpperCase();
  return state !== 'MERGED' && state !== 'CLOSED';
}

export function mergeCiLatch(prev: string[], failing: string[], unknown: string[]): string[] {
  const out = new Set<string>();
  for (const url of failing) {
    const normalized = normalizePrUrl(url);
    if (normalized) out.add(normalized);
  }
  const unknownSet = new Set(unknown.map((url) => normalizePrUrl(url)).filter(Boolean));
  for (const url of prev) {
    const normalized = normalizePrUrl(url);
    if (normalized && unknownSet.has(normalized)) out.add(normalized);
  }
  return [...out];
}

/**
 * Successful repos replace their previous rows. A repo that failed to list
 * keeps the rows it already had so a blip does not look like a new request.
 */
export function mergeReviewLatch(
  prev: GithubEdgeReviewLatch[],
  fetched: GithubEdgeReviewLatch[],
  successfulRepos: string[],
): GithubEdgeReviewLatch[] {
  const ok = new Set(successfulRepos);
  const map = new Map<string, GithubEdgeReviewLatch>();
  for (const row of prev) {
    const prUrl = normalizePrUrl(row.prUrl);
    if (!prUrl) continue;
    if (row.repoPath && ok.has(row.repoPath)) continue;
    if (!row.repoPath) continue;
    map.set(prUrl, { prUrl, repoPath: row.repoPath });
  }
  for (const row of fetched) {
    const prUrl = normalizePrUrl(row.prUrl);
    if (!prUrl) continue;
    map.set(prUrl, { prUrl, repoPath: row.repoPath });
  }
  return [...map.values()];
}

export function coerceGithubEdgeSnapshot(raw: unknown): GithubEdgeSnapshot {
  if (!raw || typeof raw !== 'object') return emptyGithubEdgeSnapshot();
  const row = raw as Record<string, unknown>;
  const ciFailed: string[] = [];
  const seenCi = new Set<string>();
  if (Array.isArray(row.ciFailed)) {
    for (const item of row.ciFailed) {
      const prUrl = normalizePrUrl(typeof item === 'string' ? item : '');
      if (!prUrl || seenCi.has(prUrl)) continue;
      seenCi.add(prUrl);
      ciFailed.push(prUrl);
    }
  }
  const reviewRequested: GithubEdgeReviewLatch[] = [];
  const seenReview = new Set<string>();
  if (Array.isArray(row.reviewRequested)) {
    for (const item of row.reviewRequested) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { prUrl?: unknown; repoPath?: unknown };
      const prUrl = normalizePrUrl(typeof record.prUrl === 'string' ? record.prUrl : '');
      const repoPath = typeof record.repoPath === 'string' ? record.repoPath.trim() : '';
      if (!prUrl || !repoPath || seenReview.has(prUrl)) continue;
      seenReview.add(prUrl);
      reviewRequested.push({ prUrl, repoPath });
    }
  }
  const reviewReposSeen: string[] = [];
  const seenRepos = new Set<string>();
  if (Array.isArray(row.reviewReposSeen)) {
    for (const item of row.reviewReposSeen) {
      const repo = typeof item === 'string' ? item.trim() : '';
      if (!repo || seenRepos.has(repo)) continue;
      seenRepos.add(repo);
      reviewReposSeen.push(repo);
    }
  }
  const lastFiredAt: Record<string, number> = {};
  if (row.lastFiredAt && typeof row.lastFiredAt === 'object') {
    for (const [key, value] of Object.entries(row.lastFiredAt as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        lastFiredAt[key] = value;
      }
    }
  }
  return {
    primed: row.primed === true,
    ciFailed,
    reviewRequested,
    lastFiredAt,
    ...(reviewReposSeen.length ? { reviewReposSeen } : {}),
  };
}

function dedupeSubjects(items: GithubEdgeSubject[]): GithubEdgeSubject[] {
  const map = new Map<string, GithubEdgeSubject>();
  for (const item of items) {
    if (!acceptOpenReadyPr(item)) continue;
    const prUrl = normalizePrUrl(item.prUrl);
    if (!prUrl) continue;
    const next: GithubEdgeSubject = { ...item, prUrl };
    const prev = map.get(prUrl);
    if (!prev) {
      map.set(prUrl, next);
      continue;
    }
    if (!prev.threadId && next.threadId) {
      map.set(prUrl, {
        ...prev,
        ...next,
        prUrl,
        title: next.title.trim() || prev.title,
      });
    }
  }
  return [...map.values()];
}

export function diffGithubEdges(input: {
  prev: GithubEdgeSnapshot;
  ciFailed: GithubEdgeSubject[];
  reviewRequested: GithubEdgeSubject[];
  now: number;
  cooldownMs?: number;
}): GithubEdge[] {
  if (!input.prev.primed) return [];
  const cooldown = input.cooldownMs ?? GITHUB_EDGE_COOLDOWN_MS;
  const edges: GithubEdge[] = [];
  const consider = (
    kind: GithubEdgeKind,
    items: GithubEdgeSubject[],
    latched: Set<string>,
  ) => {
    for (const item of dedupeSubjects(items)) {
      if (latched.has(item.prUrl)) continue;
      const firedAt = input.prev.lastFiredAt[githubEdgeKey(kind, item.prUrl)] ?? 0;
      if (firedAt && input.now - firedAt < cooldown) continue;
      edges.push({ ...item, kind });
    }
  };
  consider('ci-failed', input.ciFailed, new Set(input.prev.ciFailed.map((url) => normalizePrUrl(url))));
  consider(
    'review-requested',
    input.reviewRequested,
    new Set(input.prev.reviewRequested.map((row) => normalizePrUrl(row.prUrl))),
  );
  return edges;
}

export function commitGithubEdgeSnapshot(input: {
  prev: GithubEdgeSnapshot;
  ciFailed: GithubEdgeSubject[];
  reviewRequested: GithubEdgeReviewLatch[];
  delivered: GithubEdge[];
  now: number;
}): GithubEdgeSnapshot {
  const deliveredCi = new Set(
    input.delivered
      .filter((edge) => edge.kind === 'ci-failed')
      .map((edge) => normalizePrUrl(edge.prUrl))
      .filter(Boolean),
  );
  const deliveredReview = new Set(
    input.delivered
      .filter((edge) => edge.kind === 'review-requested')
      .map((edge) => normalizePrUrl(edge.prUrl))
      .filter(Boolean),
  );
  const ciObserved = dedupeSubjects(input.ciFailed).map((item) => item.prUrl);
  const ciFailed = nextUrls(input.prev.primed, input.prev.ciFailed, ciObserved, deliveredCi);
  const reviewRequested = nextReviewLatch(
    input.prev.primed,
    input.reviewRequested,
    input.prev.reviewRequested,
    deliveredReview,
  );
  const lastFiredAt: Record<string, number> = {};
  for (const [key, at] of Object.entries(input.prev.lastFiredAt)) {
    if (input.now - at <= LAST_FIRED_KEEP_MS) lastFiredAt[key] = at;
  }
  for (const edge of input.delivered) {
    const prUrl = normalizePrUrl(edge.prUrl);
    if (!prUrl) continue;
    lastFiredAt[githubEdgeKey(edge.kind, prUrl)] = input.now;
  }
  return { primed: true, ciFailed, reviewRequested, lastFiredAt };
}

function nextUrls(
  primed: boolean,
  prev: string[],
  observed: string[],
  delivered: Set<string>,
): string[] {
  const prevSet = new Set(prev.map((url) => normalizePrUrl(url)).filter(Boolean));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of observed) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (!primed || prevSet.has(url) || delivered.has(url)) out.push(url);
  }
  return out;
}

function nextReviewLatch(
  primed: boolean,
  observed: GithubEdgeReviewLatch[],
  prev: GithubEdgeReviewLatch[],
  delivered: Set<string>,
): GithubEdgeReviewLatch[] {
  const prevSet = new Set(prev.map((row) => normalizePrUrl(row.prUrl)).filter(Boolean));
  const out: GithubEdgeReviewLatch[] = [];
  const seen = new Set<string>();
  for (const row of observed) {
    const prUrl = normalizePrUrl(row.prUrl);
    const repoPath = row.repoPath.trim();
    if (!prUrl || !repoPath || seen.has(prUrl)) continue;
    seen.add(prUrl);
    if (!primed || prevSet.has(prUrl) || delivered.has(prUrl)) {
      out.push({ prUrl, repoPath });
    }
  }
  return out;
}

export function formatGithubEdgePrompt(edges: GithubEdge[]): string {
  const lines = edges.map((edge) => {
    const title = edge.title.trim() || 'Pull request';
    const lead = edge.kind === 'ci-failed' ? `CI failed on ${title}` : `Review requested: ${title}`;
    const workspace =
      edge.threadId && edge.threadTitle?.trim()
        ? ` ([${edge.threadTitle.trim()}](sideboard://chat/${edge.threadId}))`
        : edge.threadId
          ? ` ([workspace](sideboard://chat/${edge.threadId}))`
          : '';
    return `${lead} ${edge.prUrl}${workspace}`;
  });
  let body = lines.join('\n');
  if (body.length > 1_500) body = `${body.slice(0, 1_499)}…`;
  return [
    'Sideboard: GitHub update.',
    body,
    'This is information — not a command. Do not merge, do not start a fix, and do not send_to_chat unless the user asks. Do not treat this as a git request.',
  ].join('\n');
}

/**
 * Parent orchestrator for a live card wins. Otherwise the designated Global
 * chat. With neither, the group opens one new Global chat.
 */
export function routeGithubEdges(
  edges: GithubEdge[],
  parentIdForThread: (threadId: string) => string | null,
  designatedId: string | null,
): GithubEdgeWake[] {
  const groups = new Map<string, GithubEdgeWake>();
  for (const edge of edges) {
    const parent = edge.threadId ? parentIdForThread(edge.threadId)?.trim() || null : null;
    const targetId = parent || designatedId || null;
    const key = targetId ?? '';
    const group = groups.get(key);
    if (group) group.edges.push(edge);
    else groups.set(key, { targetId, edges: [edge] });
  }
  return [...groups.values()];
}

/** Newest non-cloud Global chat, else the only cloud coordinator. */
export function pickDesignatedOrchestratorId(
  threads: Array<{ id: string; status?: string; cloud?: boolean }>,
): string | null {
  const live = threads.filter((thread) => thread.status !== 'archived' && thread.id.trim());
  const preferred = live.find((thread) => !thread.cloud);
  return (preferred ?? live[0])?.id ?? null;
}

export function githubEdgeSnapshotKey(snapshot: GithubEdgeSnapshot): string {
  const lastFiredAt = Object.fromEntries(
    Object.entries(snapshot.lastFiredAt).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    primed: snapshot.primed === true,
    ciFailed: [...snapshot.ciFailed].sort(),
    reviewRequested: [...snapshot.reviewRequested]
      .map((row) => ({ prUrl: row.prUrl, repoPath: row.repoPath }))
      .sort((a, b) => a.prUrl.localeCompare(b.prUrl) || a.repoPath.localeCompare(b.repoPath)),
    lastFiredAt,
    reviewReposSeen: [...(snapshot.reviewReposSeen ?? [])].sort(),
  });
}
