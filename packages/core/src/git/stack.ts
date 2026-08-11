/**
 * GitHub stacked PRs via `gh stack` (github/gh-stack extension).
 * Prefer non-interactive flags — see github/gh-stack SKILL.md.
 */

import { gh } from './run.js';
import type { PrStack, PrStackLayer } from '../types/thread.js';

export type GhStackStatus =
  | { available: true }
  | { available: false; reason: string };

let cachedStatus: { at: number; status: GhStackStatus } | null = null;
const STATUS_TTL_MS = 60_000;

/** Whether `gh stack` is installed and runnable. */
export async function detectGhStack(cwd: string): Promise<GhStackStatus> {
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.at < STATUS_TTL_MS) {
    return cachedStatus.status;
  }
  const probe = await gh(['stack', 'view', '--help'], cwd, { reject: false });
  if (probe.exitCode === 0) {
    const status: GhStackStatus = { available: true };
    cachedStatus = { at: now, status };
    return status;
  }
  const err = `${probe.stderr}\n${probe.stdout}`;
  const reason = /official extension|extension install|github\/gh-stack/i.test(err)
    ? 'Install with: gh extension install github/gh-stack'
    : err.trim() || 'gh stack is not available';
  const status: GhStackStatus = { available: false, reason };
  cachedStatus = { at: now, status };
  return status;
}

/** Clear detect cache (tests). */
export function resetGhStackDetectCache(): void {
  cachedStatus = null;
}

type RawBranch = {
  name?: unknown;
  head?: unknown;
  base?: unknown;
  isCurrent?: unknown;
  isMerged?: unknown;
  isQueued?: unknown;
  needsRebase?: unknown;
  pr?: {
    number?: unknown;
    url?: unknown;
    state?: unknown;
    title?: unknown;
  };
};

type RawStackView = {
  trunk?: unknown;
  currentBranch?: unknown;
  stackNumber?: unknown;
  number?: unknown;
  branches?: unknown;
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/** Parse `gh stack view --json` stdout into PrStack. */
export function parseGhStackViewJson(raw: string): PrStack | null {
  let data: RawStackView;
  try {
    data = JSON.parse(raw) as RawStackView;
  } catch {
    return null;
  }
  if (!Array.isArray(data.branches) || data.branches.length === 0) return null;
  const trunk = str(data.trunk) || 'main';
  const currentBranch = str(data.currentBranch);
  const stackNumber = num(data.stackNumber) ?? num(data.number);

  const layers: PrStackLayer[] = [];
  for (let i = 0; i < data.branches.length; i++) {
    const b = data.branches[i] as RawBranch;
    if (!b || typeof b !== 'object') continue;
    const name = str(b.name);
    if (!name) continue;
    const pr = b.pr && typeof b.pr === 'object' ? b.pr : null;
    layers.push({
      position: i + 1,
      branchName: name,
      headSha: str(b.head) || undefined,
      baseSha: str(b.base) || undefined,
      isCurrent: Boolean(b.isCurrent) || name === currentBranch,
      isMerged: Boolean(b.isMerged),
      isQueued: Boolean(b.isQueued),
      needsRebase: Boolean(b.needsRebase),
      prNumber: pr ? num(pr.number) : null,
      prUrl: pr && str(pr.url) ? str(pr.url) : null,
      prState: pr && str(pr.state) ? str(pr.state).toUpperCase() : null,
      title: pr && str(pr.title) ? str(pr.title) : undefined,
    });
  }
  if (!layers.length) return null;

  let currentIndex = layers.findIndex((l) => l.isCurrent);
  if (currentIndex < 0 && currentBranch) {
    currentIndex = layers.findIndex((l) => l.branchName === currentBranch);
  }

  const { readyToMerge, blockedReason } = stackMergeReadiness(layers, currentIndex);

  return {
    stackNumber,
    trunk,
    currentBranch: currentBranch || layers[currentIndex]?.branchName || layers[0]!.branchName,
    layers,
    currentIndex,
    readyToMerge,
    blockedReason,
  };
}

/**
 * Merge readiness for merging through the current (or given) layer:
 * every unmerged layer from bottom through that index must be open, not needing rebase.
 */
export function stackMergeReadiness(
  layers: PrStackLayer[],
  throughIndex: number,
): { readyToMerge: boolean; blockedReason: string | null } {
  if (throughIndex < 0 || throughIndex >= layers.length) {
    return { readyToMerge: false, blockedReason: 'Not on a stack layer' };
  }
  for (let i = 0; i <= throughIndex; i++) {
    const layer = layers[i]!;
    if (layer.isMerged) continue;
    if (!layer.prNumber) {
      return {
        readyToMerge: false,
        blockedReason: `Layer ${layer.branchName} has no pull request yet`,
      };
    }
    if (layer.needsRebase) {
      return {
        readyToMerge: false,
        blockedReason: `PR #${layer.prNumber} needs rebase`,
      };
    }
    const state = (layer.prState ?? '').toUpperCase();
    if (state && state !== 'OPEN' && state !== 'QUEUED') {
      return {
        readyToMerge: false,
        blockedReason: `PR #${layer.prNumber} is ${state}`,
      };
    }
  }
  return { readyToMerge: true, blockedReason: null };
}

/** Load stack for the current worktree branch, or null if not in a stack. */
export async function getPrStack(cwd: string): Promise<PrStack | null> {
  const status = await detectGhStack(cwd);
  if (!status.available) return null;

  const result = await gh(['stack', 'view', '--json'], cwd, { reject: false });
  // Exit 2 = not in a stack
  if (result.exitCode === 2) return null;
  if (result.exitCode !== 0) {
    if (/not in a stack|no stack/i.test(`${result.stderr}\n${result.stdout}`)) {
      return null;
    }
    // Extension/API unavailable — treat as no stack rather than hard fail.
    if (result.exitCode === 9) return null;
    return null;
  }
  const json = result.stdout.trim();
  if (!json) return null;
  return parseGhStackViewJson(json);
}

/** True when this cwd's current branch is part of a GitHub stack. */
export async function isInPrStack(cwd: string): Promise<boolean> {
  return Boolean(await getPrStack(cwd));
}

export async function mergePrStack(
  cwd: string,
  opts: {
    /** PR number (merge through that PR) or stack number. */
    through: number;
    method?: 'merge' | 'squash' | 'rebase';
  },
): Promise<{ stdout: string }> {
  const status = await detectGhStack(cwd);
  if (!status.available) {
    throw new Error(status.reason);
  }
  const method = opts.method ?? 'squash';
  const methodFlag =
    method === 'rebase' ? '--rebase' : method === 'merge' ? '--merge' : '--squash';
  const args = [
    'stack',
    'merge',
    String(opts.through),
    '--yes',
    methodFlag,
  ];
  const { exitCode, stderr, stdout } = await gh(args, cwd, { reject: false });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || 'gh stack merge failed');
  }
  return { stdout };
}

/** Initialize a stack with one or more branch names (bottom → top). */
export async function initPrStack(
  cwd: string,
  branches: string[],
  opts?: { base?: string },
): Promise<void> {
  if (!branches.length) throw new Error('initPrStack requires at least one branch name');
  const status = await detectGhStack(cwd);
  if (!status.available) throw new Error(status.reason);
  const args = ['stack', 'init'];
  if (opts?.base) args.push('--base', opts.base);
  args.push(...branches);
  const { exitCode, stderr, stdout } = await gh(args, cwd, { reject: false });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || 'gh stack init failed');
  }
}

/** Add a branch on top of the current stack. */
export async function addPrStackLayer(cwd: string, branchName: string): Promise<void> {
  if (!branchName.trim()) throw new Error('branch name required');
  const status = await detectGhStack(cwd);
  if (!status.available) throw new Error(status.reason);
  const { exitCode, stderr, stdout } = await gh(
    ['stack', 'add', branchName.trim()],
    cwd,
    { reject: false },
  );
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || 'gh stack add failed');
  }
}

/** Push branches and create/update PRs (`--auto` avoids title prompts). */
export async function submitPrStack(
  cwd: string,
  opts?: { open?: boolean },
): Promise<void> {
  const status = await detectGhStack(cwd);
  if (!status.available) throw new Error(status.reason);
  const args = ['stack', 'submit', '--auto'];
  if (opts?.open) args.push('--open');
  const { exitCode, stderr, stdout } = await gh(args, cwd, { reject: false });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || 'gh stack submit failed');
  }
}

/** Check out a stack layer by PR number, stack number, URL, or branch. */
export async function checkoutPrStackLayer(
  cwd: string,
  target: string | number,
): Promise<void> {
  const status = await detectGhStack(cwd);
  if (!status.available) throw new Error(status.reason);
  const { exitCode, stderr, stdout } = await gh(
    ['stack', 'checkout', String(target)],
    cwd,
    { reject: false },
  );
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || 'gh stack checkout failed');
  }
}
