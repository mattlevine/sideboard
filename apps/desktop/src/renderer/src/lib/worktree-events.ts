/**
 * Sibling-thread worktree paths, so a setup/run output stream from another
 * tab on the same worktree costs one IPC per thread instead of one per
 * chunk. A thread's worktree does not move, but keep a short TTL so a stale
 * entry can never pin the wrong pane for long. Only resolved paths are
 * cached — a transient IPC failure / missing record must not mute a sibling
 * pane for the whole TTL — and the map is bounded so a long session does not
 * accumulate every thread id ever seen.
 */
const WORKTREE_PATH_TTL_MS = 60_000;
const WORKTREE_PATH_CACHE_MAX = 64;
const worktreePathByThread = new Map<
  string,
  { at: number; path: Promise<string | null> }
>();

export function sameWorktreePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/$/, '');
  return norm(a) === norm(b);
}

function lookupWorktreePath(threadId: string): Promise<string | null> {
  const now = Date.now();
  const hit = worktreePathByThread.get(threadId);
  if (hit && now - hit.at < WORKTREE_PATH_TTL_MS) return hit.path;
  const path = window.sideboard
    .getThreadSlim(threadId)
    .then((t) => t?.worktreePath ?? null)
    .catch(() => null)
    .then((resolved) => {
      if (resolved == null && worktreePathByThread.get(threadId)?.path === path) {
        worktreePathByThread.delete(threadId);
      }
      return resolved;
    });
  if (worktreePathByThread.size >= WORKTREE_PATH_CACHE_MAX) {
    // Map iterates in insertion order — drop the oldest entry.
    const oldest = worktreePathByThread.keys().next().value;
    if (oldest != null) worktreePathByThread.delete(oldest);
  }
  worktreePathByThread.set(threadId, { at: now, path });
  return path;
}

export async function eventOnWorktree(
  eventThreadId: string,
  currentThreadId: string,
  isCurrentWorktree: (path: string | null | undefined) => boolean,
): Promise<boolean> {
  if (eventThreadId === currentThreadId) return true;
  return isCurrentWorktree(await lookupWorktreePath(eventThreadId));
}
