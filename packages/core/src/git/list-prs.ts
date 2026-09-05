import type { PrInfo } from '../types/thread.js';
import { gh } from './run.js';

/** Fields `gh pr list --json` needs for state / label / reviewer filters. */
export const PR_LIST_JSON_FIELDS = [
  'number',
  'title',
  'headRefName',
  'url',
  'isCrossRepository',
  'author',
  'labels',
  'reviewRequests',
  'reviewDecision',
  'state',
  'isDraft',
  'assignees',
].join(',');

export const PR_LIST_STATES = ['open', 'closed', 'merged', 'all'] as const;
export type PrListState = (typeof PR_LIST_STATES)[number];

export const PR_LIST_QUEUES = ['review', 'mine', 'approved', 'changes'] as const;
export type PrListQueue = (typeof PR_LIST_QUEUES)[number];

/** `me`, `unassigned`, `all`, or a GitHub login. */
export type PrReviewerFilter = string;

export interface ListPrsOptions {
  /**
   * Review inbox shortcut. `review` = open non-draft PRs labeled `eng-review`
   * with no individual user reviewer — the "get me N tickets to review" path
   * (PRs for assigned ticket work, not the tickets). A team request is not a claim.
   */
  queue?: PrListQueue | string;
  /** GitHub PR state (default `open`). `review` / `view` aliases `queue=review`. */
  state?: PrListState | string;
  /** One or more labels (AND). Workflow tags like `eng-review`. */
  labels?: string[] | string;
  /** `me` / `@me`, `unassigned`, `all`, or a login. */
  reviewer?: PrReviewerFilter;
  /** Extra GitHub search tokens (title, `draft:true`, …). */
  query?: string;
  /** When set, keep only drafts (`true`) or ready-for-review PRs (`false`). */
  draft?: boolean;
  /**
   * Team slugs the viewer belongs to (e.g. `engineering-team`). When listing
   * the unclaimed inbox, PRs requested only of other teams are dropped.
   */
  viewerTeams?: string[];
  /** Max rows after filters (default 200 for UI / CLI). */
  limit?: number;
}

export interface ResolvedListPrsOptions {
  queue?: PrListQueue;
  state: PrListState;
  labels: string[];
  reviewer?: string;
  query?: string;
  draft?: boolean;
  viewerTeams?: string[];
  limit?: number;
}

/** Review bots that should not count as a human assignment. */
const BOT_REVIEWER_LOGINS = new Set([
  'copilot',
  'copilot-pull-request-reviewer',
  'github-actions',
  'github-advanced-security',
  'dependabot',
  'renovate',
  'greptile',
  'greptile-apps',
  'coderabbit',
  'coderabbitai',
  'cursor',
  'cursor-agent',
]);

export function normalizePrListState(state?: string | null): PrListState {
  const key = (state ?? '').trim().toLowerCase();
  if (key === 'closed') return 'closed';
  if (key === 'merged') return 'merged';
  if (key === 'all' || key === '*') return 'all';
  return 'open';
}

export function normalizePrListQueue(
  queue?: string | null,
  state?: string | null,
): PrListQueue | undefined {
  const q = (queue ?? '').trim().toLowerCase();
  if (q === 'review' || q === 'unclaimed' || q === 'inbox') return 'review';
  if (q === 'mine' || q === 'assigned') return 'mine';
  if (q === 'approved' || q === 'eng-approved') return 'approved';
  if (q === 'changes' || q === 'eng-requested-changes' || q === 'requested-changes') {
    return 'changes';
  }
  const s = (state ?? '').trim().toLowerCase();
  if (s === 'review' || s === 'view' || s === 'in-review' || s === 'in_review') {
    return 'review';
  }
  return undefined;
}

const QUEUE_DEFAULTS: Record<
  PrListQueue,
  Pick<ResolvedListPrsOptions, 'state' | 'labels' | 'reviewer' | 'draft'>
> = {
  review: {
    state: 'open',
    labels: ['eng-review'],
    reviewer: 'unassigned',
    draft: false,
  },
  mine: {
    state: 'open',
    labels: ['eng-review'],
    reviewer: 'me',
    draft: false,
  },
  approved: { state: 'open', labels: ['eng-approved'] },
  changes: { state: 'open', labels: ['eng-requested-changes'] },
};

/** Linear-style `ENG-12` or GitHub `#44` in a PR title. */
const TICKET_IN_TITLE_RE = /\b[A-Z]{2,8}-\d{1,6}\b|(?:^|[^\w/])#(\d+)\b/g;

export function ticketRefsFromPrTitle(title: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of title.matchAll(TICKET_IN_TITLE_RE)) {
    const id = match[1] ? `#${match[1]}` : match[0];
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

export function resolveListPrsOptions(opts?: ListPrsOptions): ResolvedListPrsOptions {
  const queue = normalizePrListQueue(opts?.queue, opts?.state);
  const defaults = queue ? QUEUE_DEFAULTS[queue] : undefined;
  const stateIsQueueAlias = Boolean(normalizePrListQueue(undefined, opts?.state));
  const labels = normalizePrLabels(opts?.labels);
  return {
    ...(queue ? { queue } : {}),
    state: normalizePrListState(stateIsQueueAlias ? defaults?.state : (opts?.state ?? defaults?.state)),
    labels: labels.length ? labels : (defaults?.labels ?? []),
    ...(opts?.reviewer?.trim()
      ? { reviewer: opts.reviewer.trim() }
      : defaults?.reviewer
        ? { reviewer: defaults.reviewer }
        : {}),
    ...(opts?.query?.trim() ? { query: opts.query.trim() } : {}),
    ...(opts?.draft !== undefined
      ? { draft: opts.draft }
      : defaults?.draft !== undefined
        ? { draft: defaults.draft }
        : {}),
    ...(opts?.viewerTeams?.length ? { viewerTeams: opts.viewerTeams } : {}),
    ...(opts?.limit != null ? { limit: opts.limit } : {}),
  };
}

export function normalizePrLabels(labels?: string[] | string | null): string[] {
  const raw = (Array.isArray(labels) ? labels : [labels ?? ''])
    .flatMap((part) => String(part).split(','))
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of raw) {
    const name = label.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function normalizePrReviewer(reviewer?: string | null): string {
  return (reviewer ?? '').trim().toLowerCase();
}

export function isBotReviewerLogin(login: string): boolean {
  const raw = login.trim();
  if (!raw) return true;
  if (/\[[^\]]*bot[^\]]*\]/i.test(raw)) return true;
  const n = raw.toLowerCase().replace(/\[bot\]$/i, '');
  if (n.endsWith('-bot') || n.endsWith('_bot')) return true;
  return BOT_REVIEWER_LOGINS.has(n);
}

/** Team slugs like `engineering-team` are a queue, not a personal claim. */
export function looksLikeTeamSlug(id: string): boolean {
  const n = id.trim().toLowerCase().replace(/\[bot\]$/i, '');
  if (!n) return false;
  if (n.includes('/')) return true;
  return /(^|-)team(-|$)/.test(n) || n.endsWith('-squad');
}

export function isHumanReviewerLogin(login: string): boolean {
  const raw = login.trim();
  if (!raw) return false;
  if (isBotReviewerLogin(raw) || looksLikeTeamSlug(raw)) return false;
  return true;
}

type ReviewRequestKind = 'user' | 'team' | 'bot';

export function parseReviewRequest(raw: unknown): { id: string; kind: ReviewRequestKind } | null {
  if (typeof raw === 'string') {
    const id = raw.trim();
    if (!id) return null;
    if (isBotReviewerLogin(id)) return { id, kind: 'bot' };
    if (looksLikeTeamSlug(id)) return { id, kind: 'team' };
    return { id, kind: 'user' };
  }
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as {
    __typename?: unknown;
    type?: unknown;
    login?: unknown;
    slug?: unknown;
    name?: unknown;
  };
  const typename = String(row.__typename ?? row.type ?? '');
  const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
  const login = typeof row.login === 'string' ? row.login.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const id = login || slug || name;
  if (!id) return null;
  if (/team/i.test(typename) || (slug && !login) || looksLikeTeamSlug(id)) {
    return { id: slug || name || login, kind: 'team' };
  }
  if (isBotReviewerLogin(id) || /bot/i.test(typename)) return { id, kind: 'bot' };
  return { id, kind: 'user' };
}

function collectReviewRequests(
  raw?: unknown,
): { ids: string[]; users: string[]; teams: string[] } {
  if (!Array.isArray(raw)) return { ids: [], users: [], teams: [] };
  const ids: string[] = [];
  const users: string[] = [];
  const teams: string[] = [];
  const seen = new Set<string>();
  const take = (list: string[], id: string) => {
    const key = id.toLowerCase();
    if (seen.has(`${list === teams ? 't' : list === users ? 'u' : 'i'}:${key}`)) return;
    seen.add(`${list === teams ? 't' : list === users ? 'u' : 'i'}:${key}`);
    list.push(id);
  };
  for (const item of raw) {
    const parsed = parseReviewRequest(item);
    if (!parsed) continue;
    take(ids, parsed.id);
    if (parsed.kind === 'user') take(users, parsed.id);
    if (parsed.kind === 'team') take(teams, parsed.id);
  }
  return { ids, users, teams };
}

export function reviewerIdentities(raw?: unknown): string[] {
  return collectReviewRequests(raw).ids;
}

export function humanReviewerLogins(raw?: unknown): string[] {
  return collectReviewRequests(raw).users;
}

export function teamReviewerSlugs(raw?: unknown): string[] {
  return collectReviewRequests(raw).teams;
}

export function labelNames(raw?: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
          ? (item as { name: string }).name.trim()
          : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function searchLabelToken(label: string): string {
  return /[\s:]/.test(label) ? `label:"${label.replace(/"/g, '')}"` : `label:${label}`;
}

function searchStateTokens(state: PrListState): string[] {
  if (state === 'open') return ['is:open'];
  if (state === 'closed') return ['is:closed', '-is:merged'];
  if (state === 'merged') return ['is:merged'];
  return [];
}

function isUnassignedReviewer(reviewer?: string | null): boolean {
  const key = normalizePrReviewer(reviewer);
  return key === 'unassigned' || key === 'none' || key === 'null';
}

/**
 * How many rows to ask `gh` for so client-side reviewer=unassigned still fills `limit`.
 */
export function prListFetchLimit(limit: number, reviewer?: string | null): number {
  const n = Math.max(1, Math.min(250, Math.floor(limit)));
  if (isUnassignedReviewer(reviewer)) {
    return Math.min(250, Math.max(n * 4, 80));
  }
  return n;
}

export function buildGhPrListArgs(opts: {
  slug?: string | null;
  state?: string;
  labels?: string[] | string;
  reviewer?: string;
  query?: string;
  draft?: boolean;
  limit: number;
}): string[] {
  const state = normalizePrListState(opts.state);
  const labels = normalizePrLabels(opts.labels);
  const reviewer = normalizePrReviewer(opts.reviewer);
  const query = opts.query?.trim() ?? '';
  const namedReviewer =
    reviewer &&
    reviewer !== 'all' &&
    reviewer !== '*' &&
    !isUnassignedReviewer(reviewer)
      ? reviewer === 'me' || reviewer === '@me'
        ? '@me'
        : (opts.reviewer ?? '').trim().replace(/^@/, '')
      : '';
  const useSearch = Boolean(query || namedReviewer || opts.draft === true || opts.draft === false);

  const args = [
    'pr',
    'list',
    '--json',
    PR_LIST_JSON_FIELDS,
    '--limit',
    String(Math.max(1, Math.min(250, Math.floor(opts.limit)))),
  ];

  if (useSearch) {
    const parts: string[] = [...searchStateTokens(state)];
    for (const label of labels) parts.push(searchLabelToken(label));
    if (namedReviewer) parts.push(`review-requested:${namedReviewer}`);
    if (opts.draft === true) parts.push('draft:true');
    if (opts.draft === false) parts.push('draft:false');
    if (query) parts.push(query);
    args.push('--search', parts.join(' '));
  } else {
    args.push('--state', state);
    for (const label of labels) args.push('--label', label);
  }

  if (opts.slug) args.push('--repo', opts.slug);
  return args;
}

export function parseGhPrList(stdout: string): PrInfo[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: PrInfo[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as {
      number?: unknown;
      title?: unknown;
      headRefName?: unknown;
      url?: unknown;
      isCrossRepository?: unknown;
      author?: { login?: string } | null;
      isDraft?: unknown;
      state?: unknown;
      labels?: unknown;
      reviewRequests?: unknown;
      reviewDecision?: unknown;
      assignees?: unknown;
    };
    const number = Number(item.number);
    if (!Number.isFinite(number) || number <= 0) continue;
    const requested = collectReviewRequests(item.reviewRequests);
    const reviewRequests = requested.ids;
    const reviewers = requested.users;
    const teams = requested.teams;
    const labels = labelNames(item.labels);
    const assignees = reviewerIdentities(item.assignees);
    const authorLogin = item.author?.login?.trim();
    const title = typeof item.title === 'string' ? item.title : '';
    const tickets = ticketRefsFromPrTitle(title);
    out.push({
      number,
      title,
      headRefName: typeof item.headRefName === 'string' ? item.headRefName : '',
      url: typeof item.url === 'string' ? item.url : '',
      isCrossRepository: item.isCrossRepository === true,
      ...(authorLogin ? { author: { login: authorLogin } } : {}),
      ...(item.isDraft === true ? { isDraft: true } : {}),
      ...(typeof item.state === 'string' && item.state ? { state: item.state } : {}),
      ...(labels.length ? { labels } : {}),
      ...(reviewRequests.length ? { reviewRequests } : {}),
      ...(reviewers.length ? { reviewers } : {}),
      ...(teams.length ? { teams } : {}),
      ...(typeof item.reviewDecision === 'string' && item.reviewDecision
        ? { reviewDecision: item.reviewDecision }
        : {}),
      ...(assignees.length ? { assignees } : {}),
      ...(tickets.length ? { tickets } : {}),
    });
  }
  return out;
}

function individualReviewers(
  pr: Pick<PrInfo, 'reviewers' | 'reviewRequests'>,
): string[] {
  if (pr.reviewers?.length) return pr.reviewers;
  return humanReviewerLogins(pr.reviewRequests);
}

function teamSlugsOnPr(pr: Pick<PrInfo, 'teams' | 'reviewRequests'>): string[] {
  if (pr.teams?.length) return pr.teams;
  return teamReviewerSlugs(pr.reviewRequests);
}

function requestedOfViewerTeam(
  pr: Pick<PrInfo, 'teams' | 'reviewRequests'>,
  viewerTeams?: string[],
): boolean {
  if (!viewerTeams?.length) return true;
  const mine = new Set(viewerTeams.map((slug) => slug.trim().toLowerCase()).filter(Boolean));
  if (mine.size === 0) return true;
  const teams = teamSlugsOnPr(pr);
  if (teams.length === 0) return true;
  return teams.some((slug) => mine.has(slug.toLowerCase()));
}

export function prMatchesReviewer(
  pr: Pick<PrInfo, 'reviewers' | 'reviewRequests' | 'teams'>,
  reviewer?: string | null,
  viewerTeams?: string[],
): boolean {
  const key = normalizePrReviewer(reviewer);
  if (!key || key === 'all' || key === '*') return true;
  const humans = individualReviewers(pr);
  if (key === 'unassigned' || key === 'none' || key === 'null') {
    return humans.length === 0 && requestedOfViewerTeam(pr, viewerTeams);
  }
  if (key === 'me' || key === '@me') return true;
  return humans.some((login) => login.toLowerCase() === key);
}

export function filterPrsByReviewer<T extends Pick<PrInfo, 'reviewers' | 'reviewRequests' | 'teams'>>(
  prs: T[],
  reviewer?: string | null,
  viewerTeams?: string[],
): T[] {
  return prs.filter((pr) => prMatchesReviewer(pr, reviewer, viewerTeams));
}

export function filterListedPrs<
  T extends Pick<PrInfo, 'reviewers' | 'reviewRequests' | 'teams' | 'isDraft'>,
>(
  prs: T[],
  opts?: Pick<ResolvedListPrsOptions, 'reviewer' | 'draft' | 'viewerTeams'>,
): T[] {
  let out = filterPrsByReviewer(prs, opts?.reviewer, opts?.viewerTeams);
  if (opts?.draft === false) out = out.filter((pr) => !pr.isDraft);
  if (opts?.draft === true) out = out.filter((pr) => pr.isDraft);
  return out;
}

export function applyPrListResponse(stdout: string, opts?: ListPrsOptions): PrInfo[] {
  const resolved = resolveListPrsOptions(opts);
  const listed = filterListedPrs(parseGhPrList(stdout), resolved);
  if (resolved.limit == null) return listed;
  const n = Math.max(1, Math.min(250, Math.floor(resolved.limit)));
  return listed.slice(0, n);
}

/** Team slugs the authenticated GitHub user belongs to (`engineering-team`, …). */
export async function listGithubViewerTeamSlugs(repoPath: string): Promise<string[]> {
  const { stdout, exitCode } = await gh(
    ['api', 'user/teams', '--paginate'],
    repoPath,
    { reject: false },
  );
  if (exitCode !== 0 || !stdout.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const slug = (row as { slug?: unknown }).slug;
    if (typeof slug !== 'string' || !slug.trim()) continue;
    const key = slug.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    slugs.push(slug.trim());
  }
  return slugs;
}
