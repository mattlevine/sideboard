import { teamNameFromSlug } from './teams.js';

/** Canonical worktree path for grouping tabs (browser-safe, no node:path). */
export function normalizeWorktreePath(worktreePath: string): string {
  const trimmed = worktreePath.replace(/\/+$/, '') || '/';
  const absolute = trimmed.startsWith('/');
  const parts = trimmed.split('/').filter((p) => p && p !== '.');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      out.pop();
      continue;
    }
    out.push(p);
  }
  return (absolute ? '/' : '') + out.join('/');
}

export function worktreeNameFromPath(worktreePath: string): string {
  const normalized = worktreePath.replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || worktreePath;
}

/**
 * True while the branch is still the Sideboard/Conductor-style placeholder
 * (`thread/<soccer-team>` or equal to the worktree directory name).
 */
export function isPlaceholderBranch(branchName: string, worktreePath: string): boolean {
  const branch = branchName.trim();
  if (!branch || branch === 'HEAD') return true;
  if (branch.startsWith('thread/')) return true;
  const dir = worktreeNameFromPath(worktreePath).toLowerCase();
  return branch.toLowerCase() === dir;
}

/** Branch shown in the UI — team nickname while placeholder, else the real branch. */
export function branchDisplayLabel(branchName: string, worktreePath: string): string {
  const dir = worktreeNameFromPath(worktreePath);
  if (isPlaceholderBranch(branchName, worktreePath)) {
    const slug = branchName.replace(/^thread\//, '') || dir;
    return teamNameFromSlug(slug);
  }
  return branchName.trim();
}

/**
 * Conductor-style sidebar label:
 * user override → PR title → branch (task name after rename) → soccer-team nickname.
 */
export function threadDisplayLabel(thread: {
  branchName: string;
  worktreePath: string;
  title?: string | null;
  prTitle?: string | null;
  userSetTitle?: boolean;
}): string {
  if (thread.userSetTitle && thread.title?.trim()) return thread.title.trim();
  if (thread.prTitle?.trim()) return thread.prTitle.trim();
  return branchDisplayLabel(thread.branchName, thread.worktreePath);
}

/** @deprecated Prefer threadDisplayLabel — kept for call sites that only have branch/path. */
export function worktreeDisplayLabel(thread: {
  branchName: string;
  worktreePath: string;
  title?: string | null;
  prTitle?: string | null;
  userSetTitle?: boolean;
}): string {
  return threadDisplayLabel(thread);
}

/** Stable worktree row label for a group of chat tabs. */
export function worktreeDisplayLabelForGroup(
  threads: {
    branchName: string;
    worktreePath: string;
    createdAt: string;
    title?: string | null;
    prTitle?: string | null;
    userSetTitle?: boolean;
  }[],
): string {
  if (threads.length === 0) return 'Worktree';
  const canonical = [...threads].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!;
  return threadDisplayLabel(canonical);
}
