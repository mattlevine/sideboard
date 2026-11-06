import { getPr, listBranches, listPrs } from '../git/worktree.js';
import { listIssues } from '../integrations/issues.js';
import type { PrInfo } from '../types/thread.js';
import { assertKnownProject, clip, type PhoneSources } from './phone-chats.js';

function sourceWarning(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message ? `${label}: ${message}` : `${label} failed.`;
}

/** `482` or `#482` — a pull-request number, not a title search. */
export function phonePrNumberQuery(query: string): number | null {
  const match = query.trim().match(/^#?(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/** Title shown in the picker, or the PR number (`482`, `#482`, `1482` for `482`). */
export function phonePrMatchesQuery(pr: { number: number; title: string }, query: string): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const q = raw.replace(/^#/, '');
  if (!q) return pr.title.toLowerCase().includes(raw);
  return pr.title.toLowerCase().includes(q) || String(pr.number).includes(q);
}

function prIsListedOpen(pr: PrInfo): boolean {
  const state = pr.state?.trim().toLowerCase();
  return state !== 'closed' && state !== 'merged';
}

function mergePrs(groups: Array<PrInfo | null | undefined>[]): PrInfo[] {
  const out: PrInfo[] = [];
  const seen = new Set<number>();
  for (const group of groups) {
    for (const pr of group) {
      if (!pr || seen.has(pr.number) || !prIsListedOpen(pr)) continue;
      seen.add(pr.number);
      out.push(pr);
    }
  }
  return out;
}

/**
 * Open PRs for the add-workspace picker.
 * GitHub search matches title text and misses the PR number, so a numeric
 * query also loads that PR. Rows stay only when the title or number matches.
 */
async function loadPhonePrs(path: string, query: string): Promise<PrInfo[]> {
  const number = phonePrNumberQuery(query);
  if (!query) return listPrs(path, { state: 'open', limit: 40 });
  const [searched, recent, exact] = await Promise.all([
    listPrs(path, { state: 'open', limit: 40, query: number == null ? query : String(number) }),
    listPrs(path, { state: 'open', limit: number == null ? 40 : 200 }),
    number == null ? Promise.resolve(null) : getPr(path, number).catch(() => null),
  ]);
  return mergePrs([exact ? [exact] : [], searched, recent]).filter((pr) => phonePrMatchesQuery(pr, query));
}

/** PRs, branches, and issues for the create-worktree picker. */
export async function listPhoneSources(repoPath: string, query?: string): Promise<PhoneSources> {
  const path = assertKnownProject(repoPath);
  const q = query?.trim() ?? '';
  const warnings: string[] = [];
  const [prs, branches, issues] = await Promise.all([
    loadPhonePrs(path, q).catch((err: unknown) => {
      warnings.push(sourceWarning('Pull requests', err));
      return [];
    }),
    listBranches(path).catch((err: unknown) => {
      warnings.push(sourceWarning('Branches', err));
      return [];
    }),
    listIssues(path, { limit: 40, ...(q ? { query: q } : {}) }).catch((err: unknown) => {
      warnings.push(sourceWarning('Issues', err));
      return { issues: [] };
    }),
  ]);
  const needle = q.toLowerCase();
  const branchRows = branches
    .filter((branch) => !needle || branch.name.toLowerCase().includes(needle))
    .slice(0, 50)
    .map((branch) => ({
      ref: branch.name,
      title: branch.current ? `${branch.name} (current)` : branch.name,
    }));
  return {
    prs: prs.slice(0, 40).map((pr) => ({
      ref: String(pr.number),
      title: clip(pr.title || `PR #${pr.number}`, 140),
      ...(pr.url ? { url: pr.url } : {}),
    })),
    branches: branchRows,
    issues: (issues.issues ?? []).slice(0, 40).map((issue) => ({
      ref: issue.identifier,
      title: clip(issue.title || issue.identifier, 140),
      ...(issue.url ? { url: issue.url } : {}),
    })),
    ...(warnings.length ? { warnings } : {}),
  };
}
