import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DiffCommit,
  DiffFile,
  DiffResult,
  DiffScope,
  DiffScopeStat,
} from '../types/thread.js';
import { git } from '../git/run.js';
import { isDirty, resolveDefaultBranch, resolveDiffBaseRef } from '../git/worktree.js';

/** Stable codes for the Changes panel (Cursor-style empty states). */
export type GitWorktreeStatus = 'ok' | 'missing_worktree' | 'not_git';

export async function inspectGitWorktree(worktreePath: string): Promise<GitWorktreeStatus> {
  if (!worktreePath || !existsSync(worktreePath)) return 'missing_worktree';
  const check = await git(['rev-parse', '--is-inside-work-tree'], worktreePath, {
    reject: false,
  });
  if (check.exitCode !== 0 || check.stdout.trim() !== 'true') return 'not_git';
  return 'ok';
}

/** `git init` in the worktree so Changes can track files (Cursor-style). */
export async function initializeGitRepository(worktreePath: string): Promise<void> {
  if (!worktreePath || !existsSync(worktreePath)) {
    throw new Error('Worktree not found');
  }
  const status = await inspectGitWorktree(worktreePath);
  if (status === 'ok') return;
  const result = await git(['init'], worktreePath, { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to initialize Git repository');
  }
}

/**
 * Snapshot current WIP as a stash commit (does not modify the working tree).
 * Used as the "Last Agent Turn" baseline.
 */
export async function captureTurnBaseline(worktreePath: string): Promise<string | null> {
  const status = await inspectGitWorktree(worktreePath);
  if (status !== 'ok') return null;
  const stash = await git(['stash', 'create'], worktreePath, { reject: false });
  const stashSha = stash.stdout.trim();
  if (stashSha) return stashSha;
  const head = await git(['rev-parse', '--verify', 'HEAD'], worktreePath, {
    reject: false,
  });
  return head.exitCode === 0 ? head.stdout.trim() : null;
}

function parseNameStatus(stdout: string): Array<{ status: string; path: string }> {
  const out: Array<{ status: string; path: string }> = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [status, ...pathParts] = line.split('\t');
    const path = pathParts[pathParts.length - 1];
    if (!status || !path) continue;
    out.push({ status: status[0] ?? status, path });
  }
  return out;
}

function parseNumstat(
  stdout: string,
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [addRaw, delRaw, ...pathParts] = line.split('\t');
    const path = pathParts[pathParts.length - 1];
    if (!path) continue;
    const additions = addRaw === '-' ? 0 : Number(addRaw);
    const deletions = delRaw === '-' ? 0 : Number(delRaw);
    if (!Number.isFinite(additions) && !Number.isFinite(deletions)) continue;
    map.set(path, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  return map;
}

function emptyStat(): DiffScopeStat {
  return { files: 0, additions: 0, deletions: 0 };
}

function statFromNumstat(stdout: string, extraFiles = 0): DiffScopeStat {
  const map = parseNumstat(stdout);
  let additions = 0;
  let deletions = 0;
  for (const c of map.values()) {
    additions += c.additions;
    deletions += c.deletions;
  }
  return { files: map.size + extraFiles, additions, deletions };
}

function capPatch(patch: string, maxHunk: number): string {
  if (patch.length <= maxHunk) return patch;
  return `${patch.slice(0, maxHunk)}\n\n… truncated (${patch.length - maxHunk} more chars)`;
}

async function resolveMergeBase(
  worktreePath: string,
  base: string,
  repoPath?: string,
): Promise<string> {
  const baseRef = await resolveDiffBaseRef(worktreePath, base, repoPath);
  const { stdout } = await git(['merge-base', baseRef, 'HEAD'], worktreePath, {
    reject: false,
  });
  const mb = stdout.trim();
  return mb || baseRef;
}

/** Commits on HEAD not yet on the remote tracking branch (0 if none/unknown). */
async function countUnpushedCommits(worktreePath: string): Promise<number> {
  const upstream = await git(
    ['rev-list', '--count', '@{upstream}..HEAD'],
    worktreePath,
    { reject: false },
  );
  if (upstream.exitCode === 0) {
    const n = Number(upstream.stdout.trim());
    return Number.isFinite(n) ? n : 0;
  }
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath, {
    reject: false,
  });
  const branch = head.stdout.trim();
  if (!branch || branch === 'HEAD') return 0;
  const remote = await git(
    ['rev-list', '--count', `origin/${branch}..HEAD`],
    worktreePath,
    { reject: false },
  );
  if (remote.exitCode !== 0) return 0;
  const n = Number(remote.stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

/** Split a multi-file `git diff` into path → patch. Uses the b/ path. */
function splitCombinedDiff(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!stdout.trim()) return map;
  const parts = stdout.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const full = `diff --git ${part}`.replace(/\n$/, '');
    const header = full.match(/^diff --git a\/(.+?) b\/(.+?)(?:\n|$)/);
    if (!header) continue;
    map.set(header[2]!, full);
  }
  return map;
}

async function untrackedPatch(
  worktreePath: string,
  path: string,
  maxHunk: number,
): Promise<DiffFile> {
  const { stdout: patch } = await git(
    ['diff', '--no-index', '--', '/dev/null', path],
    worktreePath,
    { reject: false },
  );
  const normalized = patch
    .replace(/^diff --git a\/.+? b\/.+?$/m, `diff --git a/${path} b/${path}`)
    .replace(/^--- .*$/m, '--- /dev/null')
    .replace(/^\+\+\+ .*$/m, `+++ b/${path}`);
  const addLines = normalized
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  return {
    path,
    status: 'A',
    patch: capPatch(normalized, maxHunk),
    additions: addLines,
    deletions: 0,
  };
}

async function listUntrackedPaths(worktreePath: string): Promise<string[]> {
  const { stdout } = await git(
    ['ls-files', '-z', '--others', '--exclude-standard'],
    worktreePath,
    { reject: false },
  );
  return stdout.split('\0').filter(Boolean);
}

async function listUntrackedFiles(
  worktreePath: string,
  maxHunk: number,
): Promise<DiffFile[]> {
  const paths = await listUntrackedPaths(worktreePath);
  if (paths.length === 0) return [];
  return Promise.all(paths.map((path) => untrackedPatch(worktreePath, path, maxHunk)));
}

function filesFromDiff(
  nameStatus: string,
  numstat: string,
  combinedDiff: string,
  maxHunk: number,
): DiffFile[] {
  const counts = parseNumstat(numstat);
  const patches = splitCombinedDiff(combinedDiff);
  const files: DiffFile[] = [];
  for (const { status, path } of parseNameStatus(nameStatus)) {
    const n = counts.get(path);
    files.push({
      path,
      status,
      patch: capPatch(patches.get(path) ?? '', maxHunk),
      additions: n?.additions,
      deletions: n?.deletions,
    });
  }
  return files;
}

async function computeScopeStats(
  worktreePath: string,
  mergeBase: string | null,
  lastTurnBase: string | null,
  untrackedCount: number,
): Promise<Record<DiffScope, DiffScopeStat>> {
  const [
    { stdout: commitsNum },
    { stdout: uncommittedNum },
    { stdout: stagedNum },
    { stdout: unstagedNum },
    lastTurnNum,
  ] = await Promise.all([
    mergeBase
      ? git(['diff', '--numstat', mergeBase], worktreePath, { reject: false })
      : Promise.resolve({ stdout: '' }),
    git(['diff', '--numstat', 'HEAD'], worktreePath, { reject: false }),
    git(['diff', '--numstat', '--cached'], worktreePath, { reject: false }),
    git(['diff', '--numstat'], worktreePath, { reject: false }),
    lastTurnBase
      ? git(['diff', '--numstat', lastTurnBase], worktreePath, { reject: false })
      : Promise.resolve({ stdout: '' }),
  ]);

  return {
    commits: mergeBase
      ? statFromNumstat(commitsNum, untrackedCount)
      : emptyStat(),
    uncommitted: statFromNumstat(uncommittedNum, untrackedCount),
    staged: statFromNumstat(stagedNum),
    unstaged: statFromNumstat(unstagedNum, untrackedCount),
    last_turn: lastTurnBase
      ? statFromNumstat(lastTurnNum.stdout, untrackedCount)
      : emptyStat(),
  };
}

export interface GetDiffOptions {
  base?: string;
  maxHunkChars?: number;
  scope?: DiffScope;
  /** Stash/commit SHA captured at the start of the last agent turn. */
  lastTurnBase?: string | null;
  /** When scope is `commits`, show only this commit's patch. */
  commitSha?: string | null;
}

/** Recent commits since merge-base (Cursor Commits submenu). */
export async function listBranchCommits(
  worktreePath: string,
  repoPath: string,
  opts?: { base?: string; max?: number },
): Promise<DiffCommit[]> {
  const status = await inspectGitWorktree(worktreePath);
  if (status !== 'ok') return [];
  const head = await git(['rev-parse', '--verify', 'HEAD'], worktreePath, {
    reject: false,
  });
  if (head.exitCode !== 0) return [];

  let base = opts?.base;
  try {
    base = base ?? (await resolveDefaultBranch(repoPath));
  } catch {
    base = 'HEAD';
  }
  const mergeBase = await resolveMergeBase(worktreePath, base, repoPath);
  const max = opts?.max ?? 40;
  const { stdout } = await git(
    [
      'log',
      '--date=relative',
      `--max-count=${max}`,
      '--format=%H%x09%h%x09%s%x09%cr',
      `${mergeBase}..HEAD`,
    ],
    worktreePath,
    { reject: false },
  );
  const commits: DiffCommit[] = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [sha, shortSha, subject, relativeTime] = line.split('\t');
    if (!sha || !shortSha) continue;
    commits.push({
      sha,
      shortSha,
      subject: subject || '(no subject)',
      relativeTime: relativeTime || '',
    });
  }
  return commits;
}

/**
 * Change set for the Changes panel, filtered by Cursor-style scope.
 */
export async function getDiff(
  worktreePath: string,
  repoPath: string,
  opts?: GetDiffOptions,
): Promise<DiffResult> {
  const status = await inspectGitWorktree(worktreePath);
  if (status === 'missing_worktree') {
    throw new Error('Worktree not found');
  }
  if (status === 'not_git') {
    throw new Error('Not a Git repository');
  }

  const maxHunk = opts?.maxHunkChars ?? 8_000;
  const scope: DiffScope = opts?.scope ?? 'commits';
  const lastTurnBase = opts?.lastTurnBase?.trim() || null;
  const hasLastTurnBase = Boolean(lastTurnBase);
  const commitSha = opts?.commitSha?.trim() || null;

  const head = await git(['rev-parse', '--verify', 'HEAD'], worktreePath, {
    reject: false,
  });
  const hasHead = head.exitCode === 0;
  const untrackedPaths = await listUntrackedPaths(worktreePath);

  if (!hasHead) {
    const files =
      scope === 'staged'
        ? []
        : (await listUntrackedFiles(worktreePath, maxHunk)).sort((a, b) =>
            a.path.localeCompare(b.path),
          );
    const untrackedStat: DiffScopeStat = {
      files: files.length,
      additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
      deletions: 0,
    };
    const zero = emptyStat();
    return {
      scope,
      commitSha: null,
      base: '(no commits)',
      files,
      stat: files.length
        ? files.map((f) => ` ${f.path} | untracked`).join('\n')
        : '(no changes)',
      dirty: files.length > 0,
      unpushed: 0,
      hasLastTurnBase,
      commits: [],
      scopeStats: {
        commits: untrackedStat,
        uncommitted: untrackedStat,
        staged: zero,
        unstaged: untrackedStat,
        last_turn: hasLastTurnBase ? untrackedStat : zero,
      },
    };
  }

  let base = opts?.base;
  try {
    base = base ?? (await resolveDefaultBranch(repoPath));
  } catch {
    base = 'HEAD';
  }
  // Prefer origin/<default> and refresh it so PR/adopt worktrees aren't
  // compared against a stale local default branch (looks like every file changed).
  base = await resolveDiffBaseRef(worktreePath, base, repoPath);
  if (base.startsWith('origin/')) {
    const short = base.slice('origin/'.length);
    await git(['fetch', 'origin', short, '--quiet'], worktreePath, {
      reject: false,
    });
    // Re-resolve after fetch in case the tip moved.
    base = await resolveDiffBaseRef(worktreePath, short, repoPath);
  }
  const mergeBase = await resolveMergeBase(worktreePath, base, repoPath);
  const scopeStats = await computeScopeStats(
    worktreePath,
    mergeBase,
    lastTurnBase,
    untrackedPaths.length,
  );

  const includeUntracked =
    (scope === 'commits' && !commitSha) ||
    scope === 'uncommitted' ||
    scope === 'unstaged' ||
    scope === 'last_turn';

  let nameStatus = '';
  let numstat = '';
  let combinedDiff = '';
  let labelBase = base;

  if (scope === 'staged') {
    const [ns, num, diff] = await Promise.all([
      git(['diff', '--name-status', '--cached'], worktreePath, { reject: false }),
      git(['diff', '--numstat', '--cached'], worktreePath, { reject: false }),
      git(['diff', '--cached'], worktreePath, { reject: false }),
    ]);
    nameStatus = ns.stdout;
    numstat = num.stdout;
    combinedDiff = diff.stdout;
    labelBase = 'staged';
  } else if (scope === 'unstaged') {
    const [ns, num, diff] = await Promise.all([
      git(['diff', '--name-status'], worktreePath, { reject: false }),
      git(['diff', '--numstat'], worktreePath, { reject: false }),
      git(['diff'], worktreePath, { reject: false }),
    ]);
    nameStatus = ns.stdout;
    numstat = num.stdout;
    combinedDiff = diff.stdout;
    labelBase = 'unstaged';
  } else if (scope === 'uncommitted') {
    const [ns, num, diff] = await Promise.all([
      git(['diff', '--name-status', 'HEAD'], worktreePath, { reject: false }),
      git(['diff', '--numstat', 'HEAD'], worktreePath, { reject: false }),
      git(['diff', 'HEAD'], worktreePath, { reject: false }),
    ]);
    nameStatus = ns.stdout;
    numstat = num.stdout;
    combinedDiff = diff.stdout;
    labelBase = 'HEAD';
  } else if (scope === 'last_turn') {
    if (!lastTurnBase) {
      const commits = await listBranchCommits(worktreePath, repoPath, { base });
      return {
        scope,
        commitSha: null,
        base: 'last turn',
        files: [],
        stat: '(no last agent turn)',
        dirty: await isDirty(worktreePath),
        unpushed: await countUnpushedCommits(worktreePath),
        hasLastTurnBase: false,
        commits,
        scopeStats,
      };
    }
    const [ns, num, diff] = await Promise.all([
      git(['diff', '--name-status', lastTurnBase], worktreePath, { reject: false }),
      git(['diff', '--numstat', lastTurnBase], worktreePath, { reject: false }),
      git(['diff', lastTurnBase], worktreePath, { reject: false }),
    ]);
    nameStatus = ns.stdout;
    numstat = num.stdout;
    combinedDiff = diff.stdout;
    labelBase = 'last turn';
  } else if (scope === 'commits' && commitSha) {
    // Single commit patch
    const range = `${commitSha}^!`;
    const [ns, num, diff] = await Promise.all([
      git(['diff', '--name-status', range], worktreePath, { reject: false }),
      git(['diff', '--numstat', range], worktreePath, { reject: false }),
      git(['diff', range], worktreePath, { reject: false }),
    ]);
    nameStatus = ns.stdout;
    numstat = num.stdout;
    combinedDiff = diff.stdout;
    labelBase = commitSha.slice(0, 7);
  } else {
    // commits — full branch delta vs merge-base (incl. working tree)
    const [ns, num, diff] = await Promise.all([
      git(['diff', '--name-status', mergeBase], worktreePath, { reject: false }),
      git(['diff', '--numstat', mergeBase], worktreePath, { reject: false }),
      git(['diff', mergeBase], worktreePath, { reject: false }),
    ]);
    nameStatus = ns.stdout;
    numstat = num.stdout;
    combinedDiff = diff.stdout;
    labelBase = base;
  }

  const commits = await listBranchCommits(worktreePath, repoPath, { base });

  const filesMap = new Map<string, DiffFile>();
  for (const file of filesFromDiff(nameStatus, numstat, combinedDiff, maxHunk)) {
    filesMap.set(file.path, file);
  }

  if (includeUntracked) {
    const untrackedFiles = await listUntrackedFiles(worktreePath, maxHunk);
    for (const file of untrackedFiles) {
      if (!filesMap.has(file.path)) filesMap.set(file.path, file);
    }
  }

  const files = [...filesMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  const { stdout: statOut } = await git(
    scope === 'staged'
      ? ['diff', '--stat', '--cached']
      : scope === 'unstaged'
        ? ['diff', '--stat']
        : scope === 'uncommitted'
          ? ['diff', '--stat', 'HEAD']
          : scope === 'last_turn' && lastTurnBase
            ? ['diff', '--stat', lastTurnBase]
            : scope === 'commits' && commitSha
              ? ['diff', '--stat', `${commitSha}^!`]
              : ['diff', '--stat', mergeBase],
    worktreePath,
    { reject: false },
  );

  return {
    scope,
    commitSha: scope === 'commits' ? commitSha : null,
    base: labelBase,
    files,
    stat: statOut.trim() || (files.length ? `${files.length} file(s)` : '(no changes)'),
    dirty: await isDirty(worktreePath),
    unpushed: await countUnpushedCommits(worktreePath),
    hasLastTurnBase,
    commits,
    scopeStats,
  };
}

/** Tracked + untracked (non-ignored) files in a worktree. */
export async function listWorktreeFiles(
  worktreePath: string,
  opts?: { maxFiles?: number },
): Promise<string[]> {
  const maxFiles = opts?.maxFiles ?? 5_000;
  const tracked = await git(['ls-files', '-z'], worktreePath, { reject: false });
  const others = await git(
    ['ls-files', '-z', '--others', '--exclude-standard'],
    worktreePath,
    { reject: false },
  );
  const paths = new Set<string>();
  for (const chunk of [tracked.stdout, others.stdout]) {
    for (const p of chunk.split('\0')) {
      if (p) paths.add(p);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b)).slice(0, maxFiles);
}

/** Keep in sync with renderer `lib/language.ts` IMAGE_EXTENSIONS. */
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
]);

function isImageRelativePath(relativePath: string): boolean {
  const base = relativePath.split('/').pop()?.toLowerCase() || '';
  const ext = base.includes('.') ? base.split('.').pop() || '' : '';
  return IMAGE_EXTENSIONS.has(ext);
}

const DEFAULT_UPLOAD_MAX_BYTES = 50_000_000;

/**
 * Read a worktree file as base64 for upload (any type, not the editor stub).
 * Rejects files larger than maxBytes.
 */
export function readWorktreeFileForUpload(
  worktreePath: string,
  relativePath: string,
  opts?: { maxBytes?: number },
): {
  path: string;
  contentBase64: string;
  size: number;
} {
  assertSafeRelativePath(relativePath);
  const maxBytes = opts?.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
  const abs = join(worktreePath, relativePath);
  const st = statSync(abs);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  if (st.size > maxBytes) {
    throw new Error(
      `File too large to upload (${st.size} bytes; max ${maxBytes})`,
    );
  }
  const buf = readFileSync(abs);
  return {
    path: relativePath,
    contentBase64: buf.toString('base64'),
    size: buf.length,
  };
}

/** Read a text (or image) file from the worktree (capped). */
export function readWorktreeFile(
  worktreePath: string,
  relativePath: string,
  opts?: { maxBytes?: number },
): {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
  encoding: 'utf8' | 'base64';
} {
  assertSafeRelativePath(relativePath);
  const maxBytes = opts?.maxBytes ?? 200_000;
  const abs = join(worktreePath, relativePath);
  const st = statSync(abs);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  const buf = readFileSync(abs);

  // Images: return base64 so the renderer can preview them (null-byte binary heuristic
  // would otherwise stub PNG/JPEG/etc. as unreadable).
  if (isImageRelativePath(relativePath)) {
    const maxImageBytes = Math.max(maxBytes, 15_000_000);
    const truncated = buf.length > maxImageBytes;
    const slice = buf.subarray(0, maxImageBytes);
    return {
      path: relativePath,
      content: slice.toString('base64'),
      truncated,
      binary: true,
      encoding: 'base64',
    };
  }

  const sample = buf.subarray(0, Math.min(buf.length, 8_000));
  const binary = sample.includes(0);
  if (binary) {
    return {
      path: relativePath,
      content: `(binary file, ${st.size} bytes)`,
      truncated: false,
      binary: true,
      encoding: 'utf8',
    };
  }
  const truncated = buf.length > maxBytes;
  const content = buf.subarray(0, maxBytes).toString('utf8');
  return {
    path: relativePath,
    content: truncated
      ? `${content}\n\n… truncated (${buf.length - maxBytes} more bytes)`
      : content,
    truncated,
    binary: false,
    encoding: 'utf8',
  };
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.includes('..') || relativePath.startsWith('/')) {
    throw new Error('Invalid path');
  }
}

/** Write a UTF-8 text file into the worktree. */
export function writeWorktreeFile(
  worktreePath: string,
  relativePath: string,
  content: string,
): { path: string } {
  assertSafeRelativePath(relativePath);
  const abs = join(worktreePath, relativePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return { path: relativePath };
}

/** Compact summary for MCP token-frugal payloads */
export async function getDiffSummary(
  worktreePath: string,
  repoPath: string,
  opts?: { maxFiles?: number; maxHunkChars?: number },
): Promise<{
  base: string;
  dirty: boolean;
  stat: string;
  files: Array<{
    path: string;
    status: string;
    patch: string;
    additions?: number;
    deletions?: number;
  }>;
  truncated: boolean;
}> {
  const full = await getDiff(worktreePath, repoPath, {
    maxHunkChars: opts?.maxHunkChars ?? 2_000,
    scope: 'commits',
  });
  const maxFiles = opts?.maxFiles ?? 10;
  return {
    base: full.base,
    dirty: full.dirty,
    stat: full.stat,
    files: full.files.slice(0, maxFiles),
    truncated: full.files.length > maxFiles,
  };
}
