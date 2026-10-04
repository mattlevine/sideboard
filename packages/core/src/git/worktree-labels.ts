import { soccerTokenFromTakenSlug, teamNameFromSlug } from './teams.js';

/** Canonical worktree path for grouping tabs (browser-safe, no node:path). */
export function normalizeWorktreePath(worktreePath: string): string {
  const trimmed = (worktreePath ?? '').replace(/\/+$/, '') || '/';
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
 * Ticket id safe for `<ticket>-<team>` (Linear `ENG-12` → `eng-12`,
 * GitHub `#44` → `44`).
 */
export function ticketSlugForBranch(sourceRef: string): string | null {
  const raw = sourceRef.trim();
  if (!raw) return null;
  const linear = raw.match(/\b([A-Za-z]{2,8}-\d{1,6})\b/);
  if (linear) return linear[1].toLowerCase();
  const hashed = raw.match(/^#(\d{1,8})$/);
  if (hashed) return hashed[1];
  const digits = raw.match(/^(\d{1,8})$/);
  if (digits) return digits[1];
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || null;
}

/** Worktree dir + placeholder branch slug when creating from a ticket. */
export function worktreeSlugForTicket(ticketRef: string, teamSlug: string): string {
  const ticket = ticketSlugForBranch(ticketRef);
  const team = teamSlug.trim().replace(/^thread\//, '');
  if (!ticket) return team;
  if (!team) return ticket;
  return `${ticket}-${team}`;
}

/**
 * True while the branch is still the Sideboard/Conductor-style placeholder
 * (soccer-team slug, leftover `thread/<team>`, or equal to the worktree dir).
 */
export function isPlaceholderBranch(branchName: string, worktreePath: string): boolean {
  const branch = branchName.trim();
  if (!branch || branch === 'HEAD') return true;
  if (branch.startsWith('thread/')) return true;
  const dir = worktreeNameFromPath(worktreePath).toLowerCase();
  const lower = branch.toLowerCase();
  if (lower === dir) return true;
  // `git worktree add -b` collisions keep the folder (`ajax`) and suffix the
  // branch (`ajax-2`). Those are still placeholders until first-turn rename.
  return Boolean(dir) && lower.startsWith(`${dir}-`) && /-\d+$/.test(lower);
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

export type WorktreeAnchorLabel = {
  title: string;
  subtitle: string | null;
};

/**
 * Parent identity for nested sidebar chats: PR title, else a human branch.
 * Placeholder soccer-team (or leftover `thread/<team>`) refs become the
 * nickname — never the raw git name, which reads as a duplicate of the first chat.
 */
export function worktreeAnchorLabel(
  threads: {
    branchName: string;
    worktreePath: string;
    createdAt: string;
    prTitle?: string | null;
  }[],
): WorktreeAnchorLabel {
  if (threads.length === 0) return { title: 'Worktree', subtitle: null };
  const canonical = [...threads].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!;
  const pr = threads.map((t) => t.prTitle?.trim()).find((v) => Boolean(v)) ?? '';
  const branch = (canonical.branchName ?? '').trim();
  const placeholder = isPlaceholderBranch(branch, canonical.worktreePath);
  const display = branchDisplayLabel(canonical.branchName, canonical.worktreePath);
  const realBranch =
    !placeholder && branch && branch !== 'HEAD' ? branch : null;
  if (pr) {
    return {
      title: pr,
      subtitle: realBranch && realBranch !== pr ? realBranch : null,
    };
  }
  if (display) {
    return {
      title: display,
      subtitle: realBranch && realBranch !== display ? realBranch : null,
    };
  }
  return {
    title: worktreeNameFromPath(canonical.worktreePath),
    subtitle: realBranch,
  };
}

/** Soccer nickname from the worktree folder, or null when the dir is not a club. */
export function agentNicknameFromWorktreePath(worktreePath: string): string | null {
  const dir = worktreeNameFromPath(worktreePath);
  if (!soccerTokenFromTakenSlug(dir)) return null;
  return teamNameFromSlug(dir);
}

/** PR / real git branch / parent row — never the nested agent’s own name. */
export function worktreeIdentityTitles(
  thread: {
    branchName?: string | null;
    worktreePath?: string | null;
    prTitle?: string | null;
  },
  parentTitle?: string | null,
): string[] {
  const out: string[] = [];
  const push = (value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) out.push(trimmed);
  };
  push(parentTitle);
  push(thread.prTitle);
  const branch = thread.branchName?.trim() ?? '';
  const path = thread.worktreePath?.trim() ?? '';
  if (branch && path && branch !== 'HEAD' && !isPlaceholderBranch(branch, path)) {
    push(branch);
  }
  return out;
}

function foldLabel(value: string): string {
  return value
    .trim()
    .replace(/[.…]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** True when `title` is the worktree/PR/branch (including a truncated copy). */
export function isWorktreeIdentityTitle(
  title: string,
  identities: readonly string[],
): boolean {
  const a = foldLabel(title);
  if (!a || a === 'untitled' || a === 'new agent') return true;
  for (const identity of identities) {
    const b = foldLabel(identity);
    if (!b) continue;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (shorter.length >= 20 && longer.startsWith(shorter)) return true;
  }
  return false;
}
