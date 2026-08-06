import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BranchInfo,
  PrCheckRun,
  PrDetails,
  PrInfo,
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
import { gh, git } from './run.js';

export type { TeamName } from './teams.js';
export { allocateTeamName, FAMOUS_SOCCER_TEAMS } from './teams.js';

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
 * Parse `owner/name` from a git remote URL (SSH or HTTPS).
 */
export function parseGithubSlugFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  const match =
    trimmed.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i) ??
    trimmed.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}/${match[2]}`;
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

  const viaGh = await gh(
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    repoPath,
    { reject: false },
  );
  if (viaGh.exitCode === 0 && viaGh.stdout.trim()) {
    return viaGh.stdout.trim();
  }

  for (const remote of ['upstream', 'github'] as const) {
    const slug = await slugFromGitRemote(repoPath, remote);
    if (slug) return slug;
  }
  return null;
}

export async function resolveDefaultBranch(repoPath: string): Promise<string> {
  const viaGh = await gh(
    ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    repoPath,
    { reject: false },
  );
  if (viaGh.exitCode === 0 && viaGh.stdout.trim()) {
    return viaGh.stdout.trim();
  }

  const viaOrigin = await git(
    ['symbolic-ref', 'refs/remotes/origin/HEAD'],
    repoPath,
    { reject: false },
  );
  if (viaOrigin.exitCode === 0 && viaOrigin.stdout.trim()) {
    return viaOrigin.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
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
  };
}

/** CI checks for a PR (`gh pr checks <selector> --json …`).
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
      return [];
    }
    throw new Error(errText || `gh pr checks failed (${exitCode})`);
  }
  try {
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    return parsed.map(normalizeCheck);
  } catch {
    throw new Error(errText || 'gh pr checks returned invalid JSON');
  }
}

/** PR description / commits / reviews (+ checks) for the Review tab. */
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
      'commits',
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

  let checks: PrCheckRun[] = [];
  try {
    checks = (await getPrChecks(cwd, selector)) ?? [];
  } catch {
    checks = [];
  }

  const author = (view.author ?? {}) as { login?: string; name?: string | null };
  const commits = Array.isArray(view.commits) ? view.commits : [];
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
    commits: commits.map((c) => {
      const row = c as Record<string, unknown>;
      const authors = Array.isArray(row.authors)
        ? row.authors.map((a) => {
            const actor = a as { login?: string; name?: string | null };
            return { login: actor.login ?? 'unknown', name: actor.name ?? null };
          })
        : [];
      return {
        oid: String(row.oid ?? ''),
        messageHeadline: String(row.messageHeadline ?? ''),
        committedDate: String(row.committedDate ?? ''),
        authors,
      };
    }),
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
    checks,
  };
}

export async function fetchPrHead(
  repoPath: string,
  number: number,
  localBranch: string,
): Promise<void> {
  await git(
    ['fetch', 'origin', `pull/${number}/head:${localBranch}`],
    repoPath,
    { reject: false },
  );
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

  return ref;
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

  // Refresh remotes first so default-branch forks track current origin/main (etc).
  await git(['fetch', 'origin', '--prune'], opts.repoPath, { reject: false });
  // Also fetch the named ref in case prune/fetch missed a new remote branch.
  if (!opts.sourceRef.startsWith('origin/') && !opts.sourceRef.startsWith('refs/')) {
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
          return { branchName, worktreePath };
        }
      }
    }
    throw new Error(
      `Failed to create worktree: ${add.stderr.trim() || add.stdout.trim() || `exit ${add.exitCode}`}`,
    );
  }

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
  const { stdout } = await git(['status', '--porcelain'], worktreePath);
  return stdout.trim().length > 0;
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
  const existing = await gh(
    ['pr', 'view', opts.head, '--json', 'url', '--jq', '.url'],
    worktreePath,
    { reject: false },
  );
  if (existing.exitCode === 0 && existing.stdout.trim() && !opts.web) {
    const url = existing.stdout.trim();
    // Refresh title/body from the latest change purpose (not the thread nickname).
    await gh(
      [
        'pr',
        'edit',
        opts.head,
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
      opts.head,
    ];
    if (opts.draft) args.push('--draft');
    await gh(args, worktreePath, { reject: false });
    // URL may open in browser; return existing view if available
    const again = await gh(
      ['pr', 'view', opts.head, '--json', 'url', '--jq', '.url'],
      worktreePath,
      { reject: false },
    );
    return again.stdout.trim() || '';
  }

  const args = [
    'pr',
    'create',
    '--title',
    opts.title,
    '--body',
    opts.body ?? opts.title,
    '--base',
    opts.base,
    '--head',
    opts.head,
  ];
  if (opts.draft) args.push('--draft');
  const { stdout } = await gh(args, worktreePath);
  const url = stdout.trim().split('\n').find((l) => l.startsWith('http')) ?? stdout.trim();
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
