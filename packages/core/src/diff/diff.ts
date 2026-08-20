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
import { isDirty, resolveDefaultBranch, resolveDiffBaseRef, isSideboardScratchPath } from '../git/worktree.js';

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

const mergeBaseCache = new Map<string, { at: number; value: string }>();
const MERGE_BASE_TTL_MS = 45_000;

async function resolveMergeBase(
  worktreePath: string,
  base: string,
  repoPath?: string,
): Promise<string> {
  const baseRef = await resolveDiffBaseRef(worktreePath, base, repoPath);
  const cacheKey = `${worktreePath}\0${baseRef}`;
  const hit = mergeBaseCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MERGE_BASE_TTL_MS) return hit.value;
  const { stdout } = await git(['merge-base', baseRef, 'HEAD'], worktreePath, {
    reject: false,
  });
  const mb = stdout.trim() || baseRef;
  mergeBaseCache.set(cacheKey, { at: Date.now(), value: mb });
  return mb;
}

/** Commits on HEAD not yet on the remote copy of this branch (0 if none/unknown). */
async function countUnpushedCommits(worktreePath: string): Promise<number> {
  // Prefer origin/<branch> over @{upstream}. Thread worktrees often track the
  // fork-from ref (origin/main), so @{upstream}..HEAD stays non-zero after
  // pushing the thread branch — which stuck the sidebar on "Commit & push"
  // for clean draft PRs.
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath, {
    reject: false,
  });
  const branch = head.stdout.trim();

  if (branch && branch !== 'HEAD') {
    const remote = await git(
      ['rev-list', '--count', `origin/${branch}..HEAD`],
      worktreePath,
      { reject: false },
    );
    if (remote.exitCode === 0) {
      const n = Number(remote.stdout.trim());
      return Number.isFinite(n) ? n : 0;
    }
  }

  const upstream = await git(
    ['rev-list', '--count', '@{upstream}..HEAD'],
    worktreePath,
    { reject: false },
  );
  if (upstream.exitCode !== 0) return 0;
  const n = Number(upstream.stdout.trim());
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

function syntheticAddPatch(
  path: string,
  content: string,
  maxHunk: number,
): DiffFile {
  const lines = content.split('\n');
  const body = lines.map((l) => `+${l}`).join('\n');
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n`;
  return {
    path,
    status: 'A',
    patch: capPatch(`${header}${body}`, maxHunk),
    additions: lines.length,
    deletions: 0,
  };
}

async function untrackedPatch(
  worktreePath: string,
  path: string,
  maxHunk: number,
): Promise<DiffFile> {
  const abs = join(worktreePath, path);
  try {
    const st = statSync(abs);
    if (st.isFile() && st.size > maxHunk) {
      const buf = readFileSync(abs).subarray(0, maxHunk);
      return syntheticAddPatch(path, buf.toString('utf8'), maxHunk);
    }
  } catch {
    // Fall through to git --no-index.
  }
  const { stdout: patch } = await git(
    ['diff', '--no-ext-diff', '--no-color', '--no-index', '--', '/dev/null', path],
    worktreePath,
    { reject: false, timeoutMs: 4_000 },
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

async function listUntrackedPaths(
  worktreePath: string,
  path?: string | null,
): Promise<string[]> {
  const args = ['ls-files', '-z', '--others', '--exclude-standard'];
  if (path) args.push('--', path);
  const { stdout } = await git(args, worktreePath, { reject: false });
  return stdout
    .split('\0')
    .filter(Boolean)
    .filter((p) => !isSideboardScratchPath(p));
}

async function listUntrackedFiles(
  worktreePath: string,
  maxHunk: number,
  paths?: string[],
): Promise<DiffFile[]> {
  const list = paths ?? (await listUntrackedPaths(worktreePath));
  if (list.length === 0) return [];
  return Promise.all(list.map((path) => untrackedPatch(worktreePath, path, maxHunk)));
}

function untrackedStubs(paths: string[]): DiffFile[] {
  return paths.map((path) => ({
    path,
    status: 'A',
    patch: '',
    additions: 0,
    deletions: 0,
  }));
}

function pathspec(path: string | null): string[] {
  return path ? ['--', path] : [];
}

function gitDiff(
  args: string[],
  cwd: string,
  opts?: { timeoutMs?: number },
) {
  return git(['diff', '--no-ext-diff', '--no-color', ...args], cwd, {
    reject: false,
    timeoutMs: opts?.timeoutMs,
  });
}

function fileFromPatch(path: string, patch: string, maxHunk: number): DiffFile {
  let status = 'M';
  if (/^new file mode /m.test(patch) || /^--- \/dev\/null/m.test(patch)) {
    status = 'A';
  } else if (
    /^deleted file mode /m.test(patch) ||
    /^\+\+\+ \/dev\/null/m.test(patch)
  ) {
    status = 'D';
  } else if (/^rename from /m.test(patch)) {
    status = 'R';
  }
  const additions = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const deletions = patch
    .split('\n')
    .filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  return {
    path,
    status,
    patch: capPatch(patch, maxHunk),
    additions,
    deletions,
  };
}

async function gitDiffParts(
  worktreePath: string,
  diffArgs: string[],
  includePatches: boolean,
  path: string | null,
): Promise<{ nameStatus: string; numstat: string; combinedDiff: string }> {
  const extra = pathspec(path);
  // One `git diff` when we need the patch — three parallel diffs each load
  // the index on large worktrees and can also invoke diff.external (delta, etc.).
  if (includePatches) {
    const diff = await gitDiff([...diffArgs, ...extra], worktreePath, {
      timeoutMs: 4_000,
    });
    return { nameStatus: '', numstat: '', combinedDiff: diff.stdout };
  }
  const [ns, num] = await Promise.all([
    gitDiff(['--name-status', ...diffArgs, ...extra], worktreePath),
    gitDiff(['--numstat', ...diffArgs, ...extra], worktreePath),
  ]);
  return {
    nameStatus: ns.stdout,
    numstat: num.stdout,
    combinedDiff: '',
  };
}

function formatStat(files: DiffFile[]): string {
  if (files.length === 0) return '(no changes)';
  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const n = files.length;
  return `${n} file${n === 1 ? '' : 's'} changed, ${additions} insertions(+), ${deletions} deletions(-)`;
}

function emptyScopeStats(): Record<DiffScope, DiffScopeStat> {
  const z = emptyStat();
  return {
    commits: z,
    uncommitted: z,
    staged: z,
    unstaged: z,
    last_turn: z,
  };
}

function filesFromDiff(
  nameStatus: string,
  numstat: string,
  combinedDiff: string,
  maxHunk: number,
): DiffFile[] {
  const patches = splitCombinedDiff(combinedDiff);
  if (!nameStatus.trim() && patches.size > 0) {
    return [...patches.entries()].map(([path, patch]) =>
      fileFromPatch(path, patch, maxHunk),
    );
  }
  const counts = parseNumstat(numstat);
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
      ? gitDiff(['--numstat', mergeBase], worktreePath)
      : Promise.resolve({ stdout: '' }),
    gitDiff(['--numstat', 'HEAD'], worktreePath),
    gitDiff(['--numstat', '--cached'], worktreePath),
    gitDiff(['--numstat'], worktreePath),
    lastTurnBase
      ? gitDiff(['--numstat', lastTurnBase], worktreePath)
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
  /**
   * When false, skip unified patches (file list + line counts only).
   * Default true. The Changes file list should pass false and load one
   * file's patch with `path` when the editor opens.
   */
  includePatches?: boolean;
  /** Scope stats, commits, dirty, unpushed. Default true. */
  includeMeta?: boolean;
  /** Untracked files. Default follows the scope (usually on). */
  includeUntracked?: boolean;
  /** Only this worktree-relative path. */
  path?: string;
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
    base = base ?? (await resolveDefaultBranch(repoPath, { network: false }));
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

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function emptyPathDiff(
  scope: DiffScope,
  base: string,
  hasLastTurnBase: boolean,
  commitSha: string | null = null,
): DiffResult {
  return {
    scope,
    commitSha: scope === 'commits' ? commitSha : null,
    base,
    files: [],
    stat: formatStat([]),
    dirty: false,
    unpushed: 0,
    hasLastTurnBase,
    commits: [],
    scopeStats: emptyScopeStats(),
  };
}

/**
 * Open one file in Diff: a single `git diff --no-ext-diff`, no worktree inspect,
 * no untracked walk, no merge-base unless this is the branch-vs-default filter.
 */
async function getPathDiff(
  worktreePath: string,
  repoPath: string,
  opts: {
    path: string;
    scope: DiffScope;
    commitSha: string | null;
    lastTurnBase: string | null;
    hasLastTurnBase: boolean;
    base?: string;
    includePatches: boolean;
    maxHunk: number;
  },
): Promise<DiffResult> {
  const { path, scope, commitSha, lastTurnBase, hasLastTurnBase, includePatches, maxHunk } =
    opts;

  if (scope === 'last_turn' && !lastTurnBase) {
    return emptyPathDiff(scope, 'last turn', false);
  }

  let diffArgs: string[];
  let labelBase: string;
  if (scope === 'staged') {
    diffArgs = ['--cached'];
    labelBase = 'staged';
  } else if (scope === 'unstaged') {
    diffArgs = [];
    labelBase = 'unstaged';
  } else if (scope === 'uncommitted') {
    diffArgs = ['HEAD'];
    labelBase = 'HEAD';
  } else if (scope === 'last_turn') {
    diffArgs = [lastTurnBase!];
    labelBase = 'last turn';
  } else if (scope === 'commits' && commitSha) {
    diffArgs = [`${commitSha}^!`];
    labelBase = commitSha.slice(0, 7);
  } else if (scope === 'commits' && opts.base && SHA_RE.test(opts.base)) {
    diffArgs = [opts.base];
    labelBase = opts.base.slice(0, 7);
  } else if (scope === 'commits') {
    let base = opts.base;
    try {
      base = base ?? (await resolveDefaultBranch(repoPath, { network: false }));
    } catch {
      base = 'HEAD';
    }
    const mergeBase = await resolveMergeBase(worktreePath, base, repoPath);
    diffArgs = [mergeBase];
    labelBase = mergeBase;
  } else {
    diffArgs = ['HEAD'];
    labelBase = 'HEAD';
  }

  const diff = await gitDiff(
    includePatches
      ? [...diffArgs, '--', path]
      : ['--name-status', ...diffArgs, '--', path],
    worktreePath,
    { timeoutMs: 4_000 },
  );

  const filesMap = new Map<string, DiffFile>();
  if (includePatches) {
    const parsed = filesFromDiff('', '', diff.stdout, maxHunk);
    for (const file of parsed) filesMap.set(file.path, file);
    if (diff.stdout.trim() && !filesMap.has(path)) {
      filesMap.set(path, fileFromPatch(path, diff.stdout, maxHunk));
    }
  } else {
    for (const file of filesFromDiff(diff.stdout, '', '', maxHunk)) {
      filesMap.set(file.path, file);
    }
  }

  if (filesMap.size === 0) {
    const maybe = await listUntrackedPaths(worktreePath, path);
    if (maybe.length > 0) {
      const extra = includePatches
        ? await listUntrackedFiles(worktreePath, maxHunk, maybe)
        : untrackedStubs(maybe);
      for (const file of extra) filesMap.set(file.path, file);
    }
  }

  const files = [...filesMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    scope,
    commitSha: scope === 'commits' ? commitSha : null,
    base: labelBase,
    files,
    stat: formatStat(files),
    dirty: files.length > 0,
    unpushed: 0,
    hasLastTurnBase,
    commits: [],
    scopeStats: emptyScopeStats(),
    mergeBase: SHA_RE.test(diffArgs[0] ?? '') ? diffArgs[0] : null,
  };
}

/**
 * Change set for the Changes panel, filtered by Cursor-style scope.
 */
export async function getDiff(
  worktreePath: string,
  repoPath: string,
  opts?: GetDiffOptions,
): Promise<DiffResult> {
  const maxHunk = opts?.maxHunkChars ?? 8_000;
  const scope: DiffScope = opts?.scope ?? 'commits';
  const lastTurnBase = opts?.lastTurnBase?.trim() || null;
  const hasLastTurnBase = Boolean(lastTurnBase);
  const commitSha = opts?.commitSha?.trim() || null;
  const includePatches = opts?.includePatches ?? true;
  const pathFilter = opts?.path?.trim() || null;
  const fileOnly = Boolean(pathFilter);
  const includeMeta = (opts?.includeMeta ?? true) && !fileOnly;

  if (fileOnly && pathFilter && !includeMeta) {
    return getPathDiff(worktreePath, repoPath, {
      path: pathFilter,
      scope,
      commitSha,
      lastTurnBase,
      hasLastTurnBase,
      base: opts?.base,
      includePatches,
      maxHunk,
    });
  }

  const status = await inspectGitWorktree(worktreePath);
  if (status === 'missing_worktree') {
    throw new Error('Worktree not found');
  }
  if (status === 'not_git') {
    throw new Error('Not a Git repository');
  }

  // Path-only loads (Diff tab) skip the untracked tree walk unless asked —
  // that walk was a multi-second cost on large worktrees.
  const wantUntracked =
    opts?.includeUntracked !== undefined
      ? opts.includeUntracked
      : !fileOnly &&
        ((scope === 'commits' && !commitSha) ||
          scope === 'uncommitted' ||
          scope === 'unstaged' ||
          scope === 'last_turn');

  const needsMergeBase =
    (scope === 'commits' && !commitSha) || includeMeta;

  const headP = git(['rev-parse', '--verify', 'HEAD'], worktreePath, {
    reject: false,
  });
  const untrackedP = wantUntracked
    ? listUntrackedPaths(worktreePath, pathFilter)
    : Promise.resolve([] as string[]);

  const head = await headP;
  const hasHead = head.exitCode === 0;

  if (!hasHead) {
    const untrackedPaths = await untrackedP;
    const files =
      scope === 'staged'
        ? []
        : includePatches
          ? (await listUntrackedFiles(worktreePath, maxHunk, untrackedPaths)).sort(
              (a, b) => a.path.localeCompare(b.path),
            )
          : untrackedStubs(untrackedPaths).sort((a, b) =>
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
      stat: formatStat(files),
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

  let mergeBase = 'HEAD';
  let baseLabel = 'HEAD';
  if (needsMergeBase) {
    let base = opts?.base;
    try {
      base = base ?? (await resolveDefaultBranch(repoPath, { network: false }));
    } catch {
      base = 'HEAD';
    }
    // Prefer origin/<default> when the remote-tracking ref already exists.
    // Do not fetch here — a remote round-trip on every Changes refresh made
    // the panel wait on the network. Worktree create / pull refresh those refs.
    // resolveMergeBase also resolves the ref (and caches) — don't double-call.
    mergeBase = await resolveMergeBase(worktreePath, base, repoPath);
    baseLabel = await resolveDiffBaseRef(worktreePath, base, repoPath);
  }

  const includeUntracked = wantUntracked;

  const metaPromise = includeMeta
    ? Promise.all([
        computeScopeStats(
          worktreePath,
          mergeBase,
          lastTurnBase,
          // Cheap: don't wait on the untracked walk just to pad the badge.
          0,
        ),
        listBranchCommits(worktreePath, repoPath, { base: baseLabel }),
        isDirty(worktreePath),
        countUnpushedCommits(worktreePath),
      ]).then(([scopeStats, commits, dirty, unpushed]) => ({
        scopeStats,
        commits,
        dirty,
        unpushed,
      }))
    : Promise.resolve({
        scopeStats: emptyScopeStats(),
        commits: [] as DiffCommit[],
        dirty: false,
        unpushed: 0,
      });

  if (scope === 'last_turn' && !lastTurnBase) {
    const meta = await metaPromise;
    return {
      scope,
      commitSha: null,
      base: 'last turn',
      files: [],
      stat: '(no last agent turn)',
      dirty: meta.dirty,
      unpushed: meta.unpushed,
      hasLastTurnBase: false,
      commits: meta.commits,
      scopeStats: meta.scopeStats,
    };
  }

  let diffArgs: string[];
  let labelBase = baseLabel;
  if (scope === 'staged') {
    diffArgs = ['--cached'];
    labelBase = 'staged';
  } else if (scope === 'unstaged') {
    diffArgs = [];
    labelBase = 'unstaged';
  } else if (scope === 'uncommitted') {
    diffArgs = ['HEAD'];
    labelBase = 'HEAD';
  } else if (scope === 'last_turn') {
    diffArgs = [lastTurnBase!];
    labelBase = 'last turn';
  } else if (scope === 'commits' && commitSha) {
    diffArgs = [`${commitSha}^!`];
    labelBase = commitSha.slice(0, 7);
  } else {
    diffArgs = [mergeBase];
    labelBase = baseLabel;
  }

  const partsPromise = gitDiffParts(
    worktreePath,
    diffArgs,
    includePatches,
    pathFilter,
  );

  const [parts, meta, untrackedPaths] = await Promise.all([
    partsPromise,
    metaPromise,
    untrackedP,
  ]);

  const filesMap = new Map<string, DiffFile>();
  for (const file of filesFromDiff(
    parts.nameStatus,
    parts.numstat,
    parts.combinedDiff,
    maxHunk,
  )) {
    filesMap.set(file.path, file);
  }

  if (includeUntracked) {
    const extra = includePatches
      ? await listUntrackedFiles(worktreePath, maxHunk, untrackedPaths)
      : untrackedStubs(untrackedPaths);
    for (const file of extra) {
      if (!filesMap.has(file.path)) filesMap.set(file.path, file);
    }
  } else if (fileOnly && pathFilter && !filesMap.has(pathFilter)) {
    // Path-only: still try a single untracked file if git had no tracked diff.
    const maybe = await listUntrackedPaths(worktreePath, pathFilter);
    if (maybe.length > 0) {
      const extra = includePatches
        ? await listUntrackedFiles(worktreePath, maxHunk, maybe)
        : untrackedStubs(maybe);
      for (const file of extra) filesMap.set(file.path, file);
    }
  }

  const files = [...filesMap.values()].sort((a, b) => a.path.localeCompare(b.path));

  // `dirty` is uncommitted working-tree dirt (`isDirty`), not "this scope has
  // files". Commits-vs-merge-base lists the PR change set; treating that as
  // dirty made the sidebar say Commit & push when the tree was already clean.
  const dirty =
    includeMeta
      ? meta.dirty
      : scope === 'commits'
        ? false
        : files.length > 0;

  return {
    scope,
    commitSha: scope === 'commits' ? commitSha : null,
    base: labelBase,
    files,
    stat: formatStat(files),
    dirty,
    unpushed: meta.unpushed,
    hasLastTurnBase,
    commits: meta.commits,
    scopeStats: meta.scopeStats,
    mergeBase: needsMergeBase ? mergeBase : null,
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
