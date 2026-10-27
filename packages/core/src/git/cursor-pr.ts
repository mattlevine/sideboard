import { git, originCli } from './run.js';
import { parseRemoteRepo } from './remote-forge.js';
import {
  applyPrListResponse,
  labelNames,
  prListFetchLimit,
  resolveListPrsOptions,
  type ListPrsOptions,
} from './list-prs.js';
import { buildMergeGateChecks, type PrMergeGate } from './pr-gates.js';
import type { PrCheckRun, PrInfo, PrMeta } from '../types/thread.js';

/** Plain `origin pr list` cannot return labels or review requests. */
const PLAIN_LIST_FIELDS = 'number,title,headRefName,url,author,state,isDraft,reviewDecision';
/** Search serializer (`--label` / `--search`) is what carries the review-queue fields. */
const SEARCH_LIST_FIELDS = `${PLAIN_LIST_FIELDS},labels,reviewRequests`;
const VIEW_FIELDS =
  'number,title,body,url,state,isDraft,reviewDecision,author,createdAt,baseRefName,headRefName,additions,deletions,changedFiles,commits,comments,reviews,labels,mergeability';

/** `owner/name` when this checkout's origin is Cursor. Null for every other host. */
export async function cursorOriginSlug(repoPath: string): Promise<string | null> {
  const result = await git(['remote', 'get-url', 'origin'], repoPath, {
    reject: false,
    timeoutMs: 5_000,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  const parsed = parseRemoteRepo(result.stdout);
  return parsed?.forge === 'cursor' ? parsed.slug : null;
}

function repoArgs(slug: string): string[] {
  return ['-R', slug];
}

/** Origin `--head` is a branch name. Strip a GitHub-style `owner:` prefix. */
export function cursorHeadBranch(head: string, slug: string): string {
  const branch = head.trim().replace(/^refs\/heads\//, '');
  const owner = slug.split('/')[0];
  if (owner && branch.startsWith(`${owner}:`)) return branch.slice(owner.length + 1);
  return branch;
}

function cursorMergeFields(value: unknown): { mergeable: string | null; mergeStateStatus: string | null } {
  if (typeof value === 'string' && value.trim()) {
    const upper = value.trim().toUpperCase();
    return { mergeable: upper, mergeStateStatus: upper };
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const conflictState = String(row.mergeConflictState ?? '').trim().toUpperCase();
    if ('hasMergeConflicts' in row || conflictState) {
      if (conflictState.includes('PENDING')) {
        return { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
      }
      const conflicting =
        row.hasMergeConflicts === true ||
        (conflictState.includes('CONFLICT') && !conflictState.includes('CLEAN'));
      if (conflicting) return { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };
      if (row.hasMergeConflicts === false || conflictState.includes('CLEAN')) {
        return { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
      }
    }
    const verdict = String(row.verdict ?? row.verdictKind ?? '').trim().toUpperCase();
    if (verdict === 'BLOCKED') return { mergeable: null, mergeStateStatus: 'BLOCKED' };
    if (verdict === 'MERGEABLE') return { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
    const status = String(row.status ?? row.state ?? row.mergeable ?? '').trim().toUpperCase();
    return { mergeable: status || null, mergeStateStatus: status || null };
  }
  return { mergeable: null, mergeStateStatus: null };
}

/** Origin says `required` / `changes_requested`; the Checks tab reads GitHub's names. */
function cursorReviewDecision(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
  if (!raw) return null;
  if (raw === 'REQUIRED' || raw === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (raw === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  if (raw === 'APPROVED') return 'APPROVED';
  return raw;
}

export function cursorViewToPrMeta(view: Record<string, unknown>): PrMeta {
  const merge = cursorMergeFields(view.mergeability ?? view.mergeable);
  const author = (view.author ?? {}) as { login?: string };
  return {
    number: Number(view.number),
    title: String(view.title ?? ''),
    url: String(view.url ?? ''),
    state: String(view.state ?? ''),
    isDraft: Boolean(view.isDraft),
    reviewDecision: cursorReviewDecision(view.reviewDecision),
    baseRefName: String(view.baseRefName ?? ''),
    headRefName: String(view.headRefName ?? ''),
    isInMergeQueue: false,
    mergeable: merge.mergeable,
    mergeStateStatus: merge.mergeStateStatus,
    authorLogin: author.login?.trim() || null,
    reviewerLogins: [],
    labels: labelNames(view.labels),
  };
}

function loginOf(author: unknown): string {
  if (!author || typeof author !== 'object') return '';
  const row = author as Record<string, unknown>;
  for (const key of ['login', 'handle', 'email', 'displayName', 'name', 'id']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function upperState(value: unknown, isDraft: boolean): string {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (raw === 'DRAFT') return 'OPEN';
  if (raw === 'OPEN' || raw === 'CLOSED' || raw === 'MERGED') return raw;
  return isDraft ? 'OPEN' : raw;
}

/** Shape Origin's PR JSON like `gh pr view` so the existing parsers can read it. */
export function normalizeOriginPr(raw: Record<string, unknown>): Record<string, unknown> {
  const isDraft = raw.isDraft === true || String(raw.status ?? raw.state ?? '').toLowerCase() === 'draft';
  const login = loginOf(raw.author);
  const author =
    raw.author && typeof raw.author === 'object'
      ? { ...(raw.author as Record<string, unknown>), login: login || 'unknown' }
      : login
        ? { login }
        : { login: 'unknown' };
  return {
    ...raw,
    isDraft,
    state: upperState(raw.state ?? raw.status, isDraft),
    author,
    body: raw.body ?? raw.description ?? '',
    isCrossRepository: false,
    reviewDecision: cursorReviewDecision(raw.reviewDecision),
    reviewRequests: originReviewRequests(raw.reviewRequests),
  };
}

/** Origin reviewers are `{kind,name,slug}`, not GitHub `{login}` / `{slug,__typename}`. */
function originReviewRequests(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map(originReviewer).filter((row) => row != null);
}

function originReviewer(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string' && raw.trim()) return { login: raw.trim() };
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.login === 'string' && row.login.trim()) return row;
  const kind = String(row.kind ?? row.__typename ?? '').toLowerCase();
  const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (kind.includes('team') || kind.includes('group') || (slug.includes('/') && !row.login)) {
    return { __typename: 'Team', slug: slug || name, name };
  }
  if (kind.includes('service') || kind.includes('bot')) {
    const login = name || id || 'cursor-bot';
    return { __typename: 'Bot', login: login.toLowerCase().endsWith('[bot]') ? login : `${login}[bot]` };
  }
  const login = name || id;
  return login ? { login } : null;
}

export function originChecksToRuns(stdout: string): PrCheckRun[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    const conclusion = typeof item.conclusion === 'string' ? item.conclusion.toLowerCase() : '';
    const status = typeof item.status === 'string' ? item.status.toLowerCase() : '';
    const bucket =
      conclusion === 'success' || conclusion === 'neutral'
        ? 'pass'
        : conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'action_required'
          ? 'fail'
          : conclusion === 'cancelled'
            ? 'cancel'
            : conclusion === 'skipped'
              ? 'skipping'
              : 'pending';
    const state = conclusion || status || 'pending';
    const link =
      typeof item.link === 'string'
        ? item.link
        : typeof item.detailsUrl === 'string'
          ? item.detailsUrl
          : null;
    const description =
      typeof item.summary === 'string'
        ? item.summary
        : typeof item.description === 'string'
          ? item.description
          : null;
    return {
      name: String(item.name ?? 'check'),
      state,
      bucket,
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
      completedAt: typeof item.completedAt === 'string' ? item.completedAt : null,
      link,
      description,
      workflow: typeof item.group === 'string' ? item.group : null,
      kind: 'ci' as const,
    };
  });
}

function listedHasLabels(pr: PrInfo, labels: string[]): boolean {
  if (labels.length === 0) return true;
  const have = new Set((pr.labels ?? []).map((name) => name.toLowerCase()));
  return labels.every((label) => have.has(label.toLowerCase()));
}

export async function listCursorPrs(
  repoPath: string,
  slug: string,
  opts?: ListPrsOptions,
  head?: string,
): Promise<PrInfo[]> {
  const resolved = resolveListPrsOptions(opts);
  const limit = Math.max(1, Math.min(250, resolved.limit ?? 200));
  const fetchLimit = prListFetchLimit(limit, resolved.reviewer);
  const useSearch = resolved.labels.length > 0 || Boolean(resolved.reviewer) || Boolean(resolved.query);
  const state = resolved.draft === true ? 'draft' : resolved.state;
  const args = [
    'pr',
    'list',
    ...repoArgs(slug),
    '--state',
    state,
    '--limit',
    String(fetchLimit),
    '--json',
    useSearch ? SEARCH_LIST_FIELDS : PLAIN_LIST_FIELDS,
  ];
  if (head?.trim()) args.push('--head', head.trim());
  if (useSearch) {
    for (const label of resolved.labels) args.push('--label', label);
    if (resolved.query) args.push('--search', resolved.query);
    else if (resolved.labels.length === 0) {
      const token = state === 'all' ? 'is:open OR is:closed OR is:merged' : `is:${state}`;
      args.push('--search', token);
    }
  }
  const { stdout, exitCode } = await originCli(args, repoPath, { reject: false, timeoutMs: 20_000 });
  if (exitCode !== 0 || !stdout.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const normalized = parsed
    .filter((row) => row && typeof row === 'object')
    .map((row) => normalizeOriginPr(row as Record<string, unknown>));
  const listed = applyPrListResponse(JSON.stringify(normalized), { ...opts, limit: undefined });
  return listed.filter((pr) => listedHasLabels(pr, resolved.labels)).slice(0, limit);
}

export async function viewCursorPr(
  repoPath: string,
  slug: string,
  selector: string,
  fields: string,
): Promise<Record<string, unknown> | null> {
  const { stdout, exitCode } = await originCli(
    ['pr', 'view', selector, ...repoArgs(slug), '--json', fields],
    repoPath,
    { reject: false, timeoutMs: 20_000 },
  );
  if (exitCode !== 0 || !stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return normalizeOriginPr(parsed);
  } catch {
    return null;
  }
}

export const CURSOR_PR_VIEW_FIELDS = VIEW_FIELDS;

export async function createOrUpdateCursorPr(
  repoPath: string,
  slug: string,
  opts: { title: string; bodyFile: string; base: string; head: string; draft?: boolean },
): Promise<string> {
  const branch = cursorHeadBranch(opts.head, slug);
  const existing = await originCli(
    ['pr', 'view', branch, ...repoArgs(slug), '--json', 'url'],
    repoPath,
    { reject: false, timeoutMs: 20_000 },
  );
  if (existing.exitCode === 0 && existing.stdout.trim()) {
    let url = '';
    try {
      url = String((JSON.parse(existing.stdout) as { url?: string }).url ?? '');
    } catch {
      url = '';
    }
    if (url) {
      await originCli(
        ['pr', 'edit', branch, ...repoArgs(slug), '--title', opts.title, '-F', opts.bodyFile],
        repoPath,
        { reject: false, timeoutMs: 20_000 },
      );
      return url;
    }
  }
  const args = [
    'pr',
    'create',
    ...repoArgs(slug),
    '--title',
    opts.title,
    '-F',
    opts.bodyFile,
    '--base',
    opts.base,
    '--head',
    branch,
    '--push',
  ];
  if (opts.draft) args.push('--draft');
  const created = await originCli(args, repoPath, { reject: false, timeoutMs: 60_000 });
  if (created.exitCode !== 0) {
    throw new Error(created.stderr.trim() || created.stdout.trim() || 'origin pr create failed');
  }
  const printed = created.stdout
    .trim()
    .split('\n')
    .find((line) => line.startsWith('http'));
  if (printed) return printed;
  const viewed = await viewCursorPr(repoPath, slug, branch, 'url');
  const url = typeof viewed?.url === 'string' ? viewed.url.trim() : '';
  return url || created.stdout.trim();
}

export async function readyCursorPr(repoPath: string, slug: string, selector: string): Promise<void> {
  const ready = await originCli(['pr', 'ready', selector, ...repoArgs(slug)], repoPath, {
    reject: false,
    timeoutMs: 20_000,
  });
  if (ready.exitCode !== 0) {
    throw new Error(ready.stderr.trim() || ready.stdout.trim() || 'Could not mark the Cursor pull request ready');
  }
}

export async function mergeCursorPr(
  repoPath: string,
  slug: string,
  selector: string,
  method: 'merge' | 'squash' | 'rebase',
): Promise<void> {
  const args = ['pr', 'merge', selector, ...repoArgs(slug)];
  if (method === 'merge') args.push('--merge');
  else if (method === 'squash') args.push('--squash');
  const merged = await originCli(args, repoPath, {
    reject: false,
    timeoutMs: 60_000,
  });
  if (merged.exitCode !== 0) {
    throw new Error(merged.stderr.trim() || merged.stdout.trim() || 'origin pr merge failed');
  }
}

export async function fetchCursorPrHead(
  repoPath: string,
  slug: string,
  number: number,
  localBranch: string,
): Promise<void> {
  const view = await viewCursorPr(repoPath, slug, String(number), 'headRefName');
  const head = typeof view?.headRefName === 'string' ? view.headRefName.trim() : '';
  if (!head) {
    throw new Error(`Could not resolve the head branch for Cursor pull request #${number}`);
  }
  const result = await git(['fetch', 'origin', `${head}:${localBranch}`], repoPath, { reject: false });
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || `git fetch origin ${head} failed`);
  }
}

export async function cursorPrChecks(
  repoPath: string,
  slug: string,
  selector: string,
): Promise<PrCheckRun[] | null> {
  const { stdout, exitCode, stderr } = await originCli(
    ['pr', 'checks', selector, ...repoArgs(slug), '--json', 'name,status,conclusion,detailsUrl,startedAt,completedAt,summary,group,link'],
    repoPath,
    { reject: false, timeoutMs: 20_000 },
  );
  const err = stderr.trim();
  let ci: PrCheckRun[];
  if (!stdout.trim()) {
    if (/no pull request|not found|no change/i.test(err)) return null;
    if (exitCode !== 0 && err) throw new Error(err);
    ci = [];
  } else {
    ci = originChecksToRuns(stdout);
  }
  const view = await viewCursorPr(
    repoPath,
    slug,
    selector,
    'url,baseRefName,reviewDecision,mergeability',
  );
  if (!view) return ci;
  return cursorChecksWithGate(ci, cursorViewToPrMeta(view));
}

function cursorChecksWithGate(ci: PrCheckRun[], meta: PrMeta): PrCheckRun[] {
  const gate: PrMergeGate = {
    mergeable: meta.mergeable,
    mergeStateStatus: meta.mergeStateStatus,
    reviewDecision: meta.reviewDecision,
    baseRefName: meta.baseRefName,
    url: meta.url,
    isInMergeQueue: meta.isInMergeQueue,
  };
  const review = (gate.reviewDecision ?? '').toUpperCase();
  const hasReviewRow = review === 'CHANGES_REQUESTED' || review === 'REVIEW_REQUIRED';
  const gateRows = buildMergeGateChecks(gate, {
    suppressGenericBlocked: ci.some((check) => check.bucket === 'fail') || hasReviewRow,
  });
  return [...gateRows, ...ci];
}
