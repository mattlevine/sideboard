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
import { allocateTeamName, type TeamName } from './teams.js';
import { worktreeNameFromPath } from './worktree-labels.js';
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

export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
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
  return branches.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPrs(repoPath: string): Promise<PrInfo[]> {
  const { stdout, exitCode } = await gh(
    [
      'pr',
      'list',
      '--json',
      'number,title,headRefName,url,isCrossRepository',
      '--limit',
      '50',
    ],
    repoPath,
    { reject: false },
  );
  if (exitCode !== 0 || !stdout.trim()) return [];
  return JSON.parse(stdout) as PrInfo[];
}

export async function getPr(
  repoPath: string,
  number: number,
): Promise<PrInfo | null> {
  const { stdout, exitCode } = await gh(
    [
      'pr',
      'view',
      String(number),
      '--json',
      'number,title,headRefName,url,isCrossRepository',
    ],
    repoPath,
    { reject: false },
  );
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

/** CI checks for a PR (`gh pr checks <selector> --json …`). */
export async function getPrChecks(
  cwd: string,
  selector: string,
): Promise<PrCheckRun[]> {
  const { stdout, exitCode, stderr } = await gh(
    [
      'pr',
      'checks',
      selector,
      '--json',
      'name,state,bucket,startedAt,completedAt,link,description,workflow',
    ],
    cwd,
    { reject: false },
  );
  // gh exits 1 on failing checks and 8 while pending — still parse JSON.
  if (!stdout.trim()) {
    if (exitCode !== 0 && exitCode !== 1 && exitCode !== 8) {
      throw new Error(stderr.trim() || `gh pr checks failed (${exitCode})`);
    }
    return [];
  }
  try {
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    return parsed.map(normalizeCheck);
  } catch {
    throw new Error(stderr.trim() || 'gh pr checks returned invalid JSON');
  }
}

/** PR description / commits / reviews (+ checks) for the Review tab. */
export async function getPrDetails(
  cwd: string,
  selector: string,
): Promise<PrDetails | null> {
  const { stdout, exitCode, stderr } = await gh(
    [
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
    ],
    cwd,
    { reject: false },
  );
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
    checks = await getPrChecks(cwd, selector);
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
  const branchName = `thread/${opts.slug}`;
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

  await git(
    ['worktree', 'add', '-b', branchName, worktreePath, startPoint],
    opts.repoPath,
  );

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

/** Slugs already used by worktree dirs, thread records, or `thread/<slug>` branches. */
export function collectTakenTeamSlugs(repoPath: string): Set<string> {
  const taken = new Set<string>();

  const root = worktreesRoot(repoPath);
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) taken.add(entry.name.toLowerCase());
    }
  }

  for (const thread of listThreads({ includeArchived: true })) {
    if (thread.repoPath !== repoPath) continue;
    taken.add(worktreeNameFromPath(thread.worktreePath).toLowerCase());
    const branchSlug = thread.branchName.replace(/^thread\//, '');
    if (branchSlug) taken.add(branchSlug.toLowerCase());
  }

  return taken;
}

/** Pick an unused soccer team for the worktree directory / branch slug. */
export function allocateTeamSlug(repoPath: string): TeamName {
  return allocateTeamName(collectTakenTeamSlugs(repoPath));
}
