import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BranchInfo, PrInfo } from '../types/thread.js';
import { worktreesRoot } from '../store/paths.js';
import { gh, git } from './run.js';

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

  // Ensure source ref exists locally
  await git(['fetch', 'origin', opts.sourceRef], opts.repoPath, { reject: false });

  const startPoint = (await git(
    ['rev-parse', '--verify', opts.sourceRef],
    opts.repoPath,
    { reject: false },
  )).exitCode === 0
    ? opts.sourceRef
    : (await git(
        ['rev-parse', '--verify', `origin/${opts.sourceRef}`],
        opts.repoPath,
        { reject: false },
      )).exitCode === 0
      ? `origin/${opts.sourceRef}`
      : opts.sourceRef;

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
  opts: { title: string; body?: string; base: string; head: string },
): Promise<string> {
  const existing = await gh(
    ['pr', 'view', opts.head, '--json', 'url', '--jq', '.url'],
    worktreePath,
    { reject: false },
  );
  if (existing.exitCode === 0 && existing.stdout.trim()) {
    return existing.stdout.trim();
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
  const { stdout } = await gh(args, worktreePath);
  const url = stdout.trim().split('\n').find((l) => l.startsWith('http')) ?? stdout.trim();
  return url;
}

export function suggestSlug(source: string): string {
  const base = slugify(source || 'thread');
  const stamp = Date.now().toString(36).slice(-4);
  return `${base || 'thread'}-${stamp}`;
}

export function worktreeNameFromPath(worktreePath: string): string {
  return basename(worktreePath);
}
