import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BranchInfo,
  PrCheckRun,
  PrDetails,
  PrInfo,
  PrMeta,
  Thread,
} from '../types/thread.js';
import { worktreesRoot } from '../store/paths.js';
import { listThreads } from '../store/thread-store.js';
import {
  allocateTeamName,
  normalizeTakenSlug,
  takenSlugsFromThread,
  type TeamName,
} from './teams.js';
import { normalizeWorktreePath } from './worktree-labels.js';
import { formatGhLandError, isGhRateLimitError } from './gh-errors.js';
import { gh, git, resolveGhAuthToken } from './run.js';
import { buildMergeGateChecks, type PrMergeGate } from './pr-gates.js';

/** Best-effort GraphQL reset time from `gh api rate_limit` (REST; often still available). */
async function lookupGithubGraphqlReset(cwd: string): Promise<number | undefined> {
  const result = await gh(['api', 'rate_limit'], cwd, { reject: false });
  if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
  try {
    const data = JSON.parse(result.stdout) as {
      resources?: { graphql?: { reset?: number } };
    };
    const reset = data.resources?.graphql?.reset;
    return typeof reset === 'number' ? reset : undefined;
  } catch {
    return undefined;
  }
}

async function formatPrCreateFailure(
  raw: string,
  cwd: string,
  ctx?: { slug?: string; head?: string },
): Promise<string> {
  if (!isGhRateLimitError(raw)) {
    return formatGhLandError(raw, {
      targetedRepo: ctx?.slug,
      headRef: ctx?.head,
    });
  }
  const resetAt = await lookupGithubGraphqlReset(cwd);
  return formatGhLandError(raw, {
    resetAt,
    targetedRepo: ctx?.slug,
    headRef: ctx?.head,
  });
}

export type { TeamName } from './teams.js';
export { allocateTeamName, FAMOUS_SOCCER_TEAMS, lookupSoccerTeam } from './teams.js';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export async function resolveRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await git(['rev-parse', '--show-toplevel'], cwd);
  return stdout.trim();
}

/**
 * Parse `owner/name` from a git remote URL (SSH, HTTPS, or SSH host aliases).
 */
export function parseGithubSlugFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/i, '');
  if (!trimmed) return null;

  // github.com HTTPS / SSH / ssh://
  const github = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (github?.[1] && github[2]) return `${github[1]}/${github[2]}`;

  // SSH host aliases: git@github.com-work:owner/repo
  const sshAlias = trimmed.match(/^git@[^:]+:([^/]+)\/([^/]+)$/i);
  if (sshAlias?.[1] && sshAlias[2]) return `${sshAlias[1]}/${sshAlias[2]}`;

  return null;
}

async function slugFromGitRemote(
  repoPath: string,
  remote: string,
): Promise<string | null> {
  const result = await git(['remote', 'get-url', remote], repoPath, {
    reject: false,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  return parseGithubSlugFromRemoteUrl(result.stdout);
}

/**
 * Resolve `owner/name` for the GitHub repository connected to a local checkout.
 * Used so Create-from PR/issue lists always target the selected workspace's remote
 * (not whatever `gh` might infer from process cwd / upstream).
 *
 * Prefer **origin** over `gh repo view`. On Makerkit-style checkouts with both
 * `origin` (your fork/product) and `upstream` (template), `gh repo view` often
 * resolves to upstream — which lists the wrong open PRs in the create modal.
 */
export async function resolveGithubRepoSlug(
  repoPath: string,
): Promise<string | null> {
  const fromOrigin = await slugFromGitRemote(repoPath, 'origin');
  if (fromOrigin) return fromOrigin;

  const hasAlt =
    Boolean(await slugFromGitRemote(repoPath, 'upstream')) ||
    Boolean(await slugFromGitRemote(repoPath, 'github'));

  // Bare `gh repo view` prefers upstream when present — never use it as a
  // stand-in for a missing/unparseable origin in dual-remote checkouts.
  if (!hasAlt) {
    const viaGh = await gh(
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      repoPath,
      { reject: false },
    );
    if (viaGh.exitCode === 0 && viaGh.stdout.trim()) {
      return viaGh.stdout.trim();
    }
  }

  for (const remote of ['upstream', 'github'] as const) {
    const slug = await slugFromGitRemote(repoPath, remote);
    if (slug) return slug;
  }
  return null;
}

/** Global `-R owner/repo` args so gh never targets upstream by accident. */
export function ghRepoSelectArgs(slug: string): string[] {
  return ['-R', slug];
}

/** Same-repo head ref as `owner:branch` (required for reliable `-R` creates). */
export function ghHeadRef(slug: string, branch: string): string {
  const owner = slug.split('/')[0];
  const head = branch.trim().replace(/^refs\/heads\//, '');
  if (!owner || !head) return head || branch;
  if (head.includes(':')) return head;
  return `${owner}:${head}`;
}

/**
 * On Makerkit-style checkouts (`origin` product + `upstream` template), `gh`
 * prefers `upstream` → so bare `gh pr create` hits the wrong GitHub repo.
 * Pin the CLI default to `origin` once per repo (shared by all worktrees).
 */
export async function ensureGhPreferOrigin(cwd: string): Promise<void> {
  const originSlug = await slugFromGitRemote(cwd, 'origin');
  if (!originSlug) return;

  const hasAlt =
    Boolean(await slugFromGitRemote(cwd, 'upstream')) ||
    Boolean(await slugFromGitRemote(cwd, 'github'));
  if (!hasAlt) return;

  const view = await gh(['repo', 'set-default', '--view'], cwd, {
    reject: false,
  });
  const current = `${view.stdout}\n${view.stderr}`;
  if (view.exitCode === 0 && current.includes(originSlug)) return;

  await gh(['repo', 'set-default', 'origin'], cwd, { reject: false });
}

/**
 * Env pin so bare `gh` (and agents) target this checkout's **origin**, not
 * Makerkit-style `upstream`. `GH_REPO` is the CLI's documented override.
 */
export async function originGhRepoEnv(
  cwd: string,
): Promise<Record<string, string>> {
  await ensureGhPreferOrigin(cwd);
  const slug = await resolveGithubRepoSlug(cwd);
  return slug ? { GH_REPO: slug } : {};
}

export async function resolveDefaultBranch(repoPath: string): Promise<string> {
  // Prefer origin (same rationale as resolveGithubRepoSlug) so Makerkit-style
  // origin+upstream checkouts don't resolve the template's default branch tip.
  const viaOrigin = await git(
    ['symbolic-ref', 'refs/remotes/origin/HEAD'],
    repoPath,
    { reject: false },
  );
  if (viaOrigin.exitCode === 0 && viaOrigin.stdout.trim()) {
    return viaOrigin.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  }

  const slug = await resolveGithubRepoSlug(repoPath);
  const viaGh = await gh(
    [
      'repo',
      'view',
      ...(slug ? ['--repo', slug] : []),
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ],
    repoPath,
    { reject: false },
  );
  if (viaGh.exitCode === 0 && viaGh.stdout.trim()) {
    return viaGh.stdout.trim();
  }

  for (const candidate of ['main', 'master']) {
    const check = await git(
      ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${candidate}`],
      repoPath,
      { reject: false },
    );
    if (check.exitCode === 0) return candidate;
  }
  for (const candidate of ['main', 'master']) {
    const check = await git(
      ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
      repoPath,
      { reject: false },
    );
    if (check.exitCode === 0) return candidate;
  }
  return 'main';
}

/**
 * Prefer `origin/<branch>` for diff/merge-base so Changes / Land don't inflate
 * against a stale local default-branch tip (common after adopting a PR).
 * Bare names like `main` upgrade when the remote-tracking ref exists; already-
 * qualified refs (`origin/main`, `refs/…`) are left alone.
 *
 * `fallbackCwd` (usually the main repo) is tried when the worktree can't see
 * the remote-tracking ref.
 */
export async function resolveDiffBaseRef(
  cwd: string,
  branchOrRef: string,
  fallbackCwd?: string,
): Promise<string> {
  const ref = branchOrRef.trim();
  if (!ref) return ref;
  if (ref.startsWith('origin/') || ref.startsWith('refs/')) return ref;
  // Feature branches often contain `/` (fix/…); only upgrade simple names.
  if (ref.includes('/')) return ref;
  const remote = `origin/${ref}`;
  for (const dir of [cwd, fallbackCwd].filter(Boolean) as string[]) {
    const ok = await git(['rev-parse', '--verify', remote], dir, { reject: false });
    if (ok.exitCode === 0) return remote;
  }
  return ref;
}

export async function listBranches(
  repoPath: string,
  opts?: { unmergedOnly?: boolean },
): Promise<BranchInfo[]> {
  const { stdout } = await git(
    ['for-each-ref', '--format=%(refname:short)|%(HEAD)|%(upstream:short)', 'refs/heads', 'refs/remotes'],
    repoPath,
  );
  const seen = new Set<string>();
  const branches: BranchInfo[] = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [name, head] = line.split('|');
    if (!name || name.endsWith('/HEAD')) continue;
    const remote = name.startsWith('origin/');
    const short = remote ? name.replace(/^origin\//, '') : name;
    if (seen.has(short) && !remote) continue;
    if (!seen.has(short)) {
      seen.add(short);
      branches.push({ name: short, remote, current: head === '*' });
    }
  }
  const sorted = branches.sort((a, b) => a.name.localeCompare(b.name));
  if (!opts?.unmergedOnly) return sorted;

  const defaultBranch = await resolveDefaultBranch(repoPath);
  // Compare against origin tip when present so local default being behind
  // doesn't falsely mark remote-tracking feature branches as merged.
  const originDefault = `origin/${defaultBranch}`;
  const originCheck = await git(
    ['rev-parse', '--verify', '--quiet', originDefault],
    repoPath,
    { reject: false },
  );
  const mergeBase =
    originCheck.exitCode === 0 ? originDefault : defaultBranch;

  const noMerged = await git(
    [
      'for-each-ref',
      `--no-merged=${mergeBase}`,
      '--format=%(refname:short)',
      'refs/heads',
      'refs/remotes/origin',
    ],
    repoPath,
    { reject: false },
  );
  const keep = new Set<string>();
  keep.add(defaultBranch);
  for (const line of noMerged.stdout.split('\n').filter(Boolean)) {
    const short = line.startsWith('origin/')
      ? line.replace(/^origin\//, '')
      : line;
    if (short && short !== 'HEAD') keep.add(short);
  }

  return sorted.filter((b) => keep.has(b.name));
}

export async function listPrs(repoPath: string): Promise<PrInfo[]> {
  const slug = await resolveGithubRepoSlug(repoPath);
  const args = [
    'pr',
    'list',
    '--json',
    'number,title,headRefName,url,isCrossRepository',
    '--limit',
    '50',
  ];
  if (slug) args.push('--repo', slug);
  const { stdout, exitCode } = await gh(args, repoPath, { reject: false });
  if (exitCode !== 0 || !stdout.trim()) return [];
  return JSON.parse(stdout) as PrInfo[];
}

export async function getPr(
  repoPath: string,
  number: number,
): Promise<PrInfo | null> {
  const slug = await resolveGithubRepoSlug(repoPath);
  const args = [
    'pr',
    'view',
    String(number),
    '--json',
    'number,title,headRefName,url,isCrossRepository',
  ];
  if (slug) args.push('--repo', slug);
  const { stdout, exitCode } = await gh(args, repoPath, { reject: false });
  if (exitCode !== 0 || !stdout.trim()) return null;
  return JSON.parse(stdout) as PrInfo;
}

/** Prefer PR URL, then PR source ref, then branch name for `gh pr …`. */
export function resolvePrSelector(thread: Pick<
  Thread,
  'prUrl' | 'sourceType' | 'sourceRef' | 'branchName'
>): string | null {
  if (thread.prUrl?.trim()) return thread.prUrl.trim();
  if (thread.sourceType === 'pr' && thread.sourceRef?.trim()) {
    return thread.sourceRef.replace(/^#/, '').trim();
  }
  if (thread.branchName?.trim()) return thread.branchName.trim();
  return null;
}

function normalizeGhTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.startsWith('0001-01-01')) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}

function normalizeCheck(raw: Record<string, unknown>): PrCheckRun {
  return {
    name: String(raw.name ?? 'check'),
    state: String(raw.state ?? ''),
    bucket: String(raw.bucket ?? 'pending'),
    startedAt: normalizeGhTime(raw.startedAt),
    completedAt: normalizeGhTime(raw.completedAt),
    link: typeof raw.link === 'string' && raw.link ? raw.link : null,
    description:
      typeof raw.description === 'string' && raw.description
        ? raw.description
        : null,
    workflow:
      typeof raw.workflow === 'string' && raw.workflow ? raw.workflow : null,
    kind: 'ci',
  };
}

async function fetchPrMergeGate(
  cwd: string,
  selector: string,
  slug: string | null,
): Promise<PrMergeGate | null> {
  const args = [
    'pr',
    'view',
    selector,
    '--json',
    'mergeable,mergeStateStatus,reviewDecision,baseRefName,url',
  ];
  if (slug) args.push('--repo', slug);
  const { stdout, exitCode, stderr } = await gh(args, cwd, { reject: false });
  if (exitCode !== 0 || !stdout.trim()) {
    if (/no pull requests found/i.test(stderr)) return null;
    return null;
  }
  try {
    const view = JSON.parse(stdout) as Record<string, unknown>;
    return {
      mergeable:
        typeof view.mergeable === 'string' && view.mergeable
          ? view.mergeable
          : null,
      mergeStateStatus:
        typeof view.mergeStateStatus === 'string' && view.mergeStateStatus
          ? view.mergeStateStatus
          : null,
      reviewDecision:
        typeof view.reviewDecision === 'string' && view.reviewDecision
          ? view.reviewDecision
          : null,
      baseRefName:
        typeof view.baseRefName === 'string' && view.baseRefName
          ? view.baseRefName
          : null,
      url: typeof view.url === 'string' && view.url ? view.url : null,
    };
  } catch {
    return null;
  }
}

/**
 * Local conflict probe for when GitHub reports mergeable=UNKNOWN (common) or
 * when `gh` can't see mergeability. Merges HEAD into `origin/<base>` via
 * `git merge-tree --write-tree` (exit 1 + "CONFLICT" ⇒ conflicts).
 */
export async function detectLocalMergeConflicts(
  cwd: string,
  baseRefName: string | null,
): Promise<{ conflicting: boolean; base: string; files: string[] }> {
  const baseName = (baseRefName?.trim() || (await resolveDefaultBranch(cwd))).replace(
    /^origin\//,
    '',
  );
  const baseRef = await resolveDiffBaseRef(cwd, baseName);
  // Ensure we have a tip to merge against (best-effort fetch).
  await git(['fetch', 'origin', baseName], cwd, { reject: false });

  const result = await git(
    ['merge-tree', '--write-tree', '--name-only', baseRef, 'HEAD'],
    cwd,
    { reject: false },
  );
  const out = `${result.stdout}\n${result.stderr}`;
  const conflicting =
    result.exitCode !== 0 || /\bCONFLICT\b/i.test(out);
  const files = conflicting
    ? [
        ...new Set(
          out
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('merge-tree:') && !/\bCONFLICT\b/i.test(l)),
        ),
      ].slice(0, 20)
    : [];
  return { conflicting, base: baseName, files };
}

/** CI checks for a PR (`gh pr checks <selector> --json …`), plus synthetic
 * mergeability / review rows (conflicts are not reported by `gh pr checks`).
 * Returns `null` when no PR exists for the selector (so UI can show “link a PR”
 * instead of “no checks yet”). Returns `[]` when a PR exists but has no checks. */
export async function getPrChecks(
  cwd: string,
  selector: string,
): Promise<PrCheckRun[] | null> {
  const slug = await resolveGithubRepoSlug(cwd);
  const args = [
    'pr',
    'checks',
    selector,
    '--json',
    'name,state,bucket,startedAt,completedAt,link,description,workflow',
  ];
  if (slug) args.push('--repo', slug);
  const { stdout, exitCode, stderr } = await gh(args, cwd, { reject: false });
  const errText = stderr.trim();
  // gh exits 1 on failing checks and 8 while pending — still parse JSON when present.
  let ciChecks: PrCheckRun[] | null;
  if (!stdout.trim()) {
    if (/no pull requests found/i.test(errText)) return null;
    if (/auth|login|HTTP\s*401|credentials|token/i.test(errText)) {
      throw new Error(errText);
    }
    if (exitCode === 0 || exitCode === 1 || exitCode === 8) {
      // Empty check list for an existing PR (or pending with nothing reported yet).
      // Exit 1 + "no pull requests" already handled above.
      if (exitCode === 1 && errText && !/fail|check/i.test(errText)) {
        // Unexpected gh error (auth, network, etc.) — don't pretend checks are empty.
        throw new Error(errText);
      }
      ciChecks = [];
    } else {
      throw new Error(errText || `gh pr checks failed (${exitCode})`);
    }
  } else {
    try {
      const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
      ciChecks = parsed.map(normalizeCheck);
    } catch {
      throw new Error(errText || 'gh pr checks returned invalid JSON');
    }
  }

  let gate = await fetchPrMergeGate(cwd, selector, slug);
  // GitHub often returns mergeable=UNKNOWN; verify with a local merge-tree.
  // Also probe when gh view fails but CI checks exist (PR is real).
  const mergeable = (gate?.mergeable ?? '').toUpperCase();
  const mergeState = (gate?.mergeStateStatus ?? '').toUpperCase();
  // GitHub often leaves mergeable=UNKNOWN; always verify unless GH already
  // reports an explicit conflict (local probe is cheap and more reliable).
  const alreadyConflicting =
    mergeable === 'CONFLICTING' || mergeState === 'DIRTY';
  const needsLocalProbe = !alreadyConflicting;

  if (needsLocalProbe) {
    try {
      const local = await detectLocalMergeConflicts(cwd, gate?.baseRefName ?? null);
      if (local.conflicting) {
        const fileHint =
          local.files.length > 0
            ? ` Conflicting paths: ${local.files.slice(0, 8).join(', ')}${local.files.length > 8 ? '…' : ''}.`
            : '';
        gate = {
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          reviewDecision: gate?.reviewDecision ?? null,
          baseRefName: local.base,
          url: gate?.url ?? null,
        };
        // Stash file hint on a synthetic description via gate url leave as-is;
        // buildMergeGateChecks uses base name — enrich after.
        const ciFailed = ciChecks.some((c) => c.bucket === 'fail');
        const review = (gate.reviewDecision ?? '').toUpperCase();
        const hasReviewRow =
          review === 'CHANGES_REQUESTED' || review === 'REVIEW_REQUIRED';
        const gateRows = buildMergeGateChecks(gate, {
          suppressGenericBlocked: ciFailed || hasReviewRow,
        }).map((row) =>
          row.kind === 'mergeability' && row.name === 'Merge conflicts'
            ? {
                ...row,
                description: `${row.description ?? ''}${fileHint}`.trim(),
              }
            : row,
        );
        return [...gateRows, ...ciChecks];
      }
      // Local merge is clean — don't surface a useless UNKNOWN pending row.
      if (gate && (mergeable === 'UNKNOWN' || mergeState === 'UNKNOWN')) {
        gate = {
          ...gate,
          mergeable: gate.mergeable === 'UNKNOWN' ? 'MERGEABLE' : gate.mergeable,
          mergeStateStatus:
            gate.mergeStateStatus === 'UNKNOWN' ? 'CLEAN' : gate.mergeStateStatus,
        };
      }
    } catch {
      // Keep GitHub gate as-is if local probe fails.
    }
  }

  if (!gate) {
    return ciChecks;
  }

  const ciFailed = ciChecks.some((c) => c.bucket === 'fail');
  const review = (gate.reviewDecision ?? '').toUpperCase();
  const hasReviewRow =
    review === 'CHANGES_REQUESTED' || review === 'REVIEW_REQUIRED';
  const gateRows = buildMergeGateChecks(gate, {
    // Avoid duplicating "blocked" when CI failures or review rows already explain it.
    suppressGenericBlocked: ciFailed || hasReviewRow,
  });
  return [...gateRows, ...ciChecks];
}

/** Lightweight PR fields for the sidebar pill — avoids nested reviews/checks GraphQL. */
export async function getPrMeta(
  cwd: string,
  selector: string,
): Promise<PrMeta | null> {
  const slug = await resolveGithubRepoSlug(cwd);
  const viewArgs = [
    'pr',
    'view',
    selector,
    '--json',
    'number,title,url,state,isDraft,reviewDecision,baseRefName,headRefName',
  ];
  if (slug) viewArgs.push('--repo', slug);
  const { stdout, exitCode, stderr } = await gh(viewArgs, cwd, { reject: false });
  if (exitCode !== 0 || !stdout.trim()) {
    if (/no pull requests found/i.test(stderr)) return null;
    return null;
  }
  try {
    const view = JSON.parse(stdout) as Record<string, unknown>;
    return {
      number: Number(view.number),
      title: String(view.title ?? ''),
      url: String(view.url ?? ''),
      state: String(view.state ?? ''),
      isDraft: Boolean(view.isDraft),
      reviewDecision:
        typeof view.reviewDecision === 'string' && view.reviewDecision
          ? view.reviewDecision
          : null,
      baseRefName: String(view.baseRefName ?? ''),
      headRefName: String(view.headRefName ?? ''),
    };
  } catch {
    return null;
  }
}

/** PR description / reviews for the Review tab (no nested CI — use getPrChecks). */
export async function getPrDetails(
  cwd: string,
  selector: string,
): Promise<PrDetails | null> {
  const slug = await resolveGithubRepoSlug(cwd);
  const viewArgs = [
    'pr',
    'view',
    selector,
    '--json',
    [
      'number',
      'title',
      'body',
      'url',
      'state',
      'isDraft',
      'reviewDecision',
      'author',
      'baseRefName',
      'headRefName',
      'additions',
      'deletions',
      'changedFiles',
      'comments',
      'reviews',
    ].join(','),
  ];
  if (slug) viewArgs.push('--repo', slug);
  const { stdout, exitCode, stderr } = await gh(viewArgs, cwd, { reject: false });
  if (exitCode !== 0 || !stdout.trim()) {
    if (stderr.trim()) {
      // No PR for this branch is a soft miss, not a hard error.
      if (/no pull requests found/i.test(stderr)) return null;
    }
    return null;
  }

  let view: Record<string, unknown>;
  try {
    view = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(stderr.trim() || 'gh pr view returned invalid JSON');
  }

  const author = (view.author ?? {}) as { login?: string; name?: string | null };
  const comments = Array.isArray(view.comments) ? view.comments : [];
  const reviews = Array.isArray(view.reviews) ? view.reviews : [];

  return {
    number: Number(view.number),
    title: String(view.title ?? ''),
    body: String(view.body ?? ''),
    url: String(view.url ?? ''),
    state: String(view.state ?? ''),
    isDraft: Boolean(view.isDraft),
    reviewDecision:
      typeof view.reviewDecision === 'string' && view.reviewDecision
        ? view.reviewDecision
        : null,
    author: { login: author.login ?? 'unknown', name: author.name ?? null },
    baseRefName: String(view.baseRefName ?? ''),
    headRefName: String(view.headRefName ?? ''),
    additions: Number(view.additions ?? 0),
    deletions: Number(view.deletions ?? 0),
    changedFiles: Number(view.changedFiles ?? 0),
    // Commits live in Changes; omit from GraphQL to save rate-limit points.
    commits: [],
    comments: comments.map((c) => {
      const row = c as Record<string, unknown>;
      const a = (row.author ?? {}) as { login?: string };
      return {
        author: { login: a.login ?? 'unknown' },
        body: String(row.body ?? ''),
        createdAt: String(row.createdAt ?? ''),
      };
    }),
    reviews: reviews.map((r) => {
      const row = r as Record<string, unknown>;
      const a = (row.author ?? {}) as { login?: string };
      return {
        author: { login: a.login ?? 'unknown' },
        state: String(row.state ?? ''),
        body: String(row.body ?? ''),
        submittedAt: normalizeGhTime(row.submittedAt),
      };
    }),
    // CI lives in Checks tab via getPrChecks — nesting burned GraphQL points.
    checks: [],
  };
}

export async function fetchPrHead(
  repoPath: string,
  number: number,
  localBranch: string,
): Promise<void> {
  const slug = await resolveGithubRepoSlug(repoPath);
  const refspec = `+pull/${number}/head:${localBranch}`;
  const errors: string[] = [];
  const httpsRemote = slug ? `https://github.com/${slug}.git` : null;

  const tryFetch = async (
    remote: string,
    opts?: { ghAuth?: boolean },
  ): Promise<boolean> => {
    const label = opts?.ghAuth ? `${remote} (gh auth)` : remote;
    const gitOpts: {
      reject: false;
      env?: Record<string, string>;
      config?: Record<string, string>;
    } = { reject: false };

    if (opts?.ghAuth) {
      const token = await resolveGhAuthToken(repoPath);
      if (!token) {
        errors.push(`${label}: gh auth token unavailable`);
        return false;
      }
      // Dock/Finder launches often lack SSH agent; gh keyring still works.
      // AUTHORIZATION must be uppercase so git does not strip the header.
      gitOpts.env = { GIT_TERMINAL_PROMPT: '0' };
      gitOpts.config = {
        'http.extraHeader': `AUTHORIZATION: bearer ${token}`,
      };
    }

    const result = await git(['fetch', remote, refspec], repoPath, gitOpts);
    if (result.exitCode === 0) return true;
    const detail = (result.stderr || result.stdout).trim();
    if (detail) errors.push(`${label}: ${detail}`);
    return false;
  };

  let fetched = await tryFetch('origin');
  if (!fetched && httpsRemote) {
    // Origin may be a fork / mirror that doesn't expose pull/*/head — fetch from
    // the GitHub repo Sideboard listed the PR against.
    fetched = await tryFetch(httpsRemote);
    if (!fetched) fetched = await tryFetch(httpsRemote, { ghAuth: true });
  }

  const localOk = async () => {
    const verify = await git(['rev-parse', '--verify', localBranch], repoPath, {
      reject: false,
    });
    return verify.exitCode === 0;
  };

  if (!(await localOk())) {
    // Last resort: resolve the PR head SHA via gh and point a local branch at it.
    const viewArgs = [
      'pr',
      'view',
      String(number),
      '--json',
      'headRefOid',
    ];
    if (slug) viewArgs.push('--repo', slug);
    const view = await gh(viewArgs, repoPath, { reject: false });
    let oid = '';
    if (view.exitCode === 0 && view.stdout.trim()) {
      try {
        oid = String(
          (JSON.parse(view.stdout) as { headRefOid?: string }).headRefOid ?? '',
        ).trim();
      } catch {
        oid = '';
      }
    }
    if (oid) {
      // Ensure the object exists locally before branching.
      const ensureOid = async (
        remote: string,
        opts?: { ghAuth?: boolean },
      ) => {
        const gitOpts: {
          reject: false;
          env?: Record<string, string>;
          config?: Record<string, string>;
        } = { reject: false };
        if (opts?.ghAuth) {
          const token = await resolveGhAuthToken(repoPath);
          if (!token) return false;
          gitOpts.env = { GIT_TERMINAL_PROMPT: '0' };
          gitOpts.config = {
            'http.extraHeader': `AUTHORIZATION: bearer ${token}`,
          };
        }
        const got = await git(['fetch', remote, oid], repoPath, gitOpts);
        return got.exitCode === 0;
      };
      let haveObject =
        (
          await git(['cat-file', '-e', `${oid}^{commit}`], repoPath, {
            reject: false,
          })
        ).exitCode === 0;
      if (!haveObject) haveObject = await ensureOid('origin');
      if (!haveObject && httpsRemote) {
        haveObject = await ensureOid(httpsRemote);
        if (!haveObject) {
          haveObject = await ensureOid(httpsRemote, { ghAuth: true });
        }
      }
      if (haveObject) {
        const branched = await git(['branch', '-f', localBranch, oid], repoPath, {
          reject: false,
        });
        if (branched.exitCode !== 0) {
          const detail = (branched.stderr || branched.stdout).trim();
          if (detail) errors.push(`branch -f: ${detail}`);
        }
      } else {
        errors.push(`could not fetch commit ${oid.slice(0, 12)}`);
      }
    } else if (view.stderr.trim()) {
      errors.push(view.stderr.trim());
    }
  }

  if (!(await localOk())) {
    const hint = errors.length ? ` (${errors.join(' | ')})` : '';
    throw new Error(
      `Failed to fetch PR #${number} head into ${localBranch}${hint}`,
    );
  }
}

export interface CreateWorktreeResult {
  branchName: string;
  worktreePath: string;
}

/**
 * Prefer an up-to-date remote tip (`origin/<branch>`) after fetch so new
 * worktrees don't fork from a stale local main/master.
 * Local-only refs (e.g. fetched PR heads, existing thread branches) stay local.
 */
export async function resolveWorktreeStartPoint(
  repoPath: string,
  sourceRef: string,
): Promise<string> {
  const ref = sourceRef.trim();
  if (!ref) throw new Error('sourceRef is required');

  if (ref.startsWith('origin/') || ref.startsWith('refs/')) {
    const ok = await git(['rev-parse', '--verify', ref], repoPath, {
      reject: false,
    });
    if (ok.exitCode === 0) return ref;
    throw new Error(`Invalid git reference: ${ref}`);
  }

  const remote = `origin/${ref}`;
  const remoteOk = await git(['rev-parse', '--verify', remote], repoPath, {
    reject: false,
  });
  if (remoteOk.exitCode === 0) return remote;

  const localOk = await git(['rev-parse', '--verify', ref], repoPath, {
    reject: false,
  });
  if (localOk.exitCode === 0) return ref;

  throw new Error(`Invalid git reference: ${ref}`);
}

/** Local-only refs created by fetchPrHead — never exist on origin. */
function isLocalPrFetchBranch(ref: string): boolean {
  return /^sideboard-pr-\d+$/.test(ref.trim());
}

export async function createThreadWorktree(opts: {
  repoPath: string;
  sourceRef: string;
  slug: string;
}): Promise<CreateWorktreeResult> {
  let branchName = `thread/${opts.slug}`;
  const worktreePath = join(worktreesRoot(opts.repoPath), opts.slug);

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists at ${worktreePath}`);
  }

  // Pin gh to origin before agents run `gh pr …` in this worktree.
  await ensureGhPreferOrigin(opts.repoPath);

  // Refresh remotes first so default-branch forks track current origin/main (etc).
  // Skip prune when starting from a local PR fetch branch — prune is unrelated,
  // and a following `fetch origin sideboard-pr-N` would never succeed.
  await git(['fetch', 'origin', '--prune'], opts.repoPath, { reject: false });
  // Also fetch the named ref in case prune/fetch missed a new remote branch.
  if (
    !isLocalPrFetchBranch(opts.sourceRef) &&
    !opts.sourceRef.startsWith('origin/') &&
    !opts.sourceRef.startsWith('refs/')
  ) {
    await git(['fetch', 'origin', opts.sourceRef], opts.repoPath, {
      reject: false,
    });
  }

  const startPoint = await resolveWorktreeStartPoint(
    opts.repoPath,
    opts.sourceRef,
  );

  // Conductor: one workspace per branch — if branch is already checked out,
  // create a sibling branch with -2/-3 suffix instead of failing cryptically.
  const add = await git(
    ['worktree', 'add', '-b', branchName, worktreePath, startPoint],
    opts.repoPath,
    { reject: false },
  );
  if (add.exitCode !== 0) {
    const err = `${add.stderr}\n${add.stdout}`;
    if (/already used by worktree|already exists|checked out/i.test(err)) {
      for (let n = 2; n <= 20; n++) {
        const alt = `${branchName}-${n}`;
        const retry = await git(
          ['worktree', 'add', '-b', alt, worktreePath, startPoint],
          opts.repoPath,
          { reject: false },
        );
        if (retry.exitCode === 0) {
          branchName = alt;
          await ensureGhPreferOrigin(worktreePath);
          return { branchName, worktreePath };
        }
      }
    }
    throw new Error(
      `Failed to create worktree: ${add.stderr.trim() || add.stdout.trim() || `exit ${add.exitCode}`}`,
    );
  }

  await ensureGhPreferOrigin(worktreePath);
  return { branchName, worktreePath };
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  opts?: { deleteBranch?: string },
): Promise<void> {
  await git(['worktree', 'remove', '--force', worktreePath], repoPath, {
    reject: false,
  });
  if (opts?.deleteBranch) {
    await git(['branch', '-D', opts.deleteBranch], repoPath, { reject: false });
  }
}

export async function listWorktrees(repoPath: string): Promise<
  Array<{ path: string; branch: string | null }>
> {
  const { stdout } = await git(
    ['worktree', 'list', '--porcelain'],
    repoPath,
    { reject: false },
  );
  if (!stdout.trim()) return [];
  const entries: Array<{ path: string; branch: string | null }> = [];
  let current: { path: string; branch: string | null } | null = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current) entries.push(current);
  return entries;
}

export async function isDirty(worktreePath: string): Promise<boolean> {
  // -uall expands untracked dirs so we can ignore Sideboard scratch without
  // treating `?? .sideboard/` as push-relevant dirt.
  const { stdout } = await git(['status', '--porcelain', '-uall'], worktreePath);
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const rel = porcelainStatusPath(line);
    if (!rel || isSideboardScratchPath(rel)) continue;
    return true;
  }
  return false;
}

/**
 * Local Sideboard attachment scratch (review guidelines seed, composer drops).
 * Must not force the right-sidebar primary action to "Commit & push".
 */
export function isSideboardScratchPath(relativePath: string): boolean {
  const p = relativePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
  return (
    p === '.sideboard/attachments' || p.startsWith('.sideboard/attachments/')
  );
}

/** Path from a `git status --porcelain` line (handles renames + quoted paths). */
function porcelainStatusPath(line: string): string {
  // "XY PATH" or "XY PATH -> PATH2" (optional quotes around paths)
  const rest = line.length >= 3 ? line.slice(3) : '';
  if (!rest) return '';
  const arrow = rest.lastIndexOf(' -> ');
  const raw = arrow >= 0 ? rest.slice(arrow + 4) : rest;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\([\\"])/g, '$1');
  }
  return raw;
}

export async function currentBranch(worktreePath: string): Promise<string> {
  const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  return stdout.trim();
}

export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<boolean> {
  const dirty = await isDirty(worktreePath);
  if (!dirty) return false;
  await git(['add', '-A'], worktreePath);
  await git(['commit', '-m', message], worktreePath);
  return true;
}

export async function pushBranch(
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await git(['push', '-u', 'origin', branchName], worktreePath);
}

/** Merge an open pull request via `gh pr merge` (squash by default).
 * Draft PRs are marked ready first — GitHub rejects merge while still draft. */
export async function mergePr(
  cwd: string,
  selector: string,
  opts?: { method?: 'merge' | 'squash' | 'rebase' },
): Promise<{ url: string; state: string }> {
  const slug = await resolveGithubRepoSlug(cwd);
  const viewArgs = ['pr', 'view', selector, '--json', 'url,state,isDraft'];
  if (slug) viewArgs.push('--repo', slug);
  const before = await gh(viewArgs, cwd, { reject: false });
  if (before.exitCode !== 0 || !before.stdout.trim()) {
    throw new Error(before.stderr.trim() || 'Could not load pull request');
  }
  let url = '';
  let isDraft = false;
  try {
    const parsed = JSON.parse(before.stdout) as {
      url?: string;
      state?: string;
      isDraft?: boolean;
    };
    url = String(parsed.url ?? '');
    isDraft = Boolean(parsed.isDraft);
    if (String(parsed.state ?? '').toUpperCase() === 'MERGED') {
      return { url, state: 'MERGED' };
    }
  } catch {
    throw new Error('Could not parse pull request details');
  }

  if (isDraft) {
    const readyArgs = ['pr', 'ready', selector];
    if (slug) readyArgs.push('--repo', slug);
    const ready = await gh(readyArgs, cwd, { reject: false });
    if (ready.exitCode !== 0) {
      throw new Error(
        ready.stderr.trim() ||
          ready.stdout.trim() ||
          'Could not mark draft pull request as ready',
      );
    }
  }

  const method = opts?.method ?? 'squash';
  const mergeFlag =
    method === 'rebase' ? '--rebase' : method === 'merge' ? '--merge' : '--squash';
  const args = ['pr', 'merge', selector, mergeFlag, '--delete-branch=false'];
  if (slug) args.push('--repo', slug);
  const { exitCode, stderr, stdout } = await gh(args, cwd, { reject: false });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || 'gh pr merge failed');
  }

  const after = await gh(viewArgs, cwd, { reject: false });
  if (after.exitCode === 0 && after.stdout.trim()) {
    try {
      const parsed = JSON.parse(after.stdout) as { url?: string; state?: string };
      return {
        url: String(parsed.url ?? url),
        state: String(parsed.state ?? 'MERGED'),
      };
    } catch {
      // fall through
    }
  }
  return { url, state: 'MERGED' };
}

export async function createOrUpdatePr(
  worktreePath: string,
  opts: {
    title: string;
    body?: string;
    base: string;
    head: string;
    draft?: boolean;
    /** Open the GitHub PR form in the browser instead of creating via API. */
    web?: boolean;
  },
): Promise<string> {
  // Prefer origin over `gh`'s inferred repo — Makerkit-style checkouts with
  // origin + upstream otherwise create PRs against the template upstream.
  await ensureGhPreferOrigin(worktreePath);
  const slug = await resolveGithubRepoSlug(worktreePath);
  if (!slug) {
    throw new Error(
      'Could not resolve the origin GitHub repo (owner/name) for this worktree. ' +
        'Check that `git remote get-url origin` points at github.com.',
    );
  }
  const repoArgs = ghRepoSelectArgs(slug);
  const headRef = ghHeadRef(slug, opts.head);
  const branchOnly = opts.head.trim().replace(/^refs\/heads\//, '');

  const existing = await gh(
    [...repoArgs, 'pr', 'view', branchOnly, '--json', 'url', '--jq', '.url'],
    worktreePath,
    { reject: false },
  );
  if (existing.exitCode === 0 && existing.stdout.trim() && !opts.web) {
    const url = existing.stdout.trim();
    // Refresh title/body from the latest change purpose (not the thread nickname).
    await gh(
      [
        ...repoArgs,
        'pr',
        'edit',
        branchOnly,
        '--title',
        opts.title,
        '--body',
        opts.body ?? opts.title,
      ],
      worktreePath,
      { reject: false },
    );
    return url;
  }

  if (opts.web) {
    const args = [
      ...repoArgs,
      'pr',
      'create',
      '--web',
      '--title',
      opts.title,
      '--body',
      opts.body ?? opts.title,
      '--base',
      opts.base,
      '--head',
      headRef,
    ];
    if (opts.draft) args.push('--draft');
    await gh(args, worktreePath, { reject: false });
    // URL may open in browser; return existing view if available
    const again = await gh(
      [...repoArgs, 'pr', 'view', branchOnly, '--json', 'url', '--jq', '.url'],
      worktreePath,
      { reject: false },
    );
    return again.stdout.trim() || '';
  }

  const args = [
    ...repoArgs,
    'pr',
    'create',
    '--title',
    opts.title,
    '--body',
    opts.body ?? opts.title,
    '--base',
    opts.base,
    '--head',
    headRef,
  ];
  if (opts.draft) args.push('--draft');
  const created = await gh(args, worktreePath, { reject: false });
  if (created.exitCode !== 0) {
    const raw =
      created.stderr.trim() ||
      created.stdout.trim() ||
      'gh pr create failed';
    throw new Error(await formatPrCreateFailure(raw, worktreePath, { slug, head: headRef }));
  }
  const url =
    created.stdout.trim().split('\n').find((l) => l.startsWith('http')) ??
    created.stdout.trim();
  return url;
}

/** @deprecated Prefer allocateTeamSlug — kept for any external callers. */
export function suggestSlug(source: string): string {
  const base = slugify(source || 'thread');
  const stamp = Date.now().toString(36).slice(-4);
  return `${base || 'thread'}-${stamp}`;
}

export {
  branchDisplayLabel,
  isPlaceholderBranch,
  normalizeWorktreePath,
  threadDisplayLabel,
  worktreeDisplayLabel,
  worktreeDisplayLabelForGroup,
  worktreeNameFromPath,
} from './worktree-labels.js';

function sameRepoPath(a: string, b: string): boolean {
  return normalizeWorktreePath(a) === normalizeWorktreePath(b);
}

/** Local `thread/*` branch tips under `.git/refs/heads/thread` (best-effort). */
function listLocalThreadBranchSlugs(repoPath: string): string[] {
  const refsDir = join(repoPath, '.git', 'refs', 'heads', 'thread');
  if (!existsSync(refsDir)) return [];
  try {
    return readdirSync(refsDir)
      .filter((name) => !name.startsWith('.'))
      .map((name) => normalizeTakenSlug(name));
  } catch {
    return [];
  }
}

/** Slugs already used by worktree dirs, thread records, or `thread/<slug>` branches. */
export function collectTakenTeamSlugs(repoPath: string): Set<string> {
  const taken = new Set<string>();

  const root = worktreesRoot(repoPath);
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '.DS_Store') {
        taken.add(normalizeTakenSlug(entry.name));
      }
    }
  }

  for (const slug of listLocalThreadBranchSlugs(repoPath)) {
    taken.add(slug);
  }

  for (const thread of listThreads({ includeArchived: true })) {
    if (!sameRepoPath(thread.repoPath, repoPath)) continue;
    for (const slug of takenSlugsFromThread(thread)) {
      taken.add(slug);
    }
  }

  return taken;
}

/** Pick an unused soccer team for the worktree directory / branch slug. */
export function allocateTeamSlug(repoPath: string): TeamName {
  const taken = collectTakenTeamSlugs(repoPath);
  // Retry if a dir appeared between collect and allocate (or stale taken set).
  for (let attempt = 0; attempt < 32; attempt++) {
    const team = allocateTeamName(taken);
    const path = join(worktreesRoot(repoPath), team.slug);
    if (!existsSync(path)) return team;
    taken.add(team.slug);
  }
  throw new Error('No available soccer team worktree directories left');
}
