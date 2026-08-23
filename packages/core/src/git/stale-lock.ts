import { existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * git holds `index.lock` only for the life of one command (typically
 * milliseconds). A lock older than this is almost certainly abandoned by a
 * crashed or OOM-killed process, not a slow one still running.
 */
export const STALE_INDEX_LOCK_MS = 20_000;

/** Match git's "Unable to create '.../index.lock': File exists." failure. */
export function isIndexLockError(text: string): boolean {
  return /Unable to create ['"][^'"]*index\.lock['"]: File exists/i.test(text);
}

/**
 * Remove `index.lock` under `gitDir` if present and older than `maxAgeMs`.
 * A stale lock blocks every further git command on the repo — Sideboard's
 * own actions and the user's own terminal git alike — until it's cleared.
 * Returns the removed path, or null if nothing was removed.
 */
export function clearStaleIndexLock(
  gitDir: string,
  maxAgeMs: number = STALE_INDEX_LOCK_MS,
  now: number = Date.now(),
): string | null {
  const lockPath = join(gitDir, 'index.lock');
  try {
    if (!existsSync(lockPath)) return null;
    if (now - statSync(lockPath).mtimeMs < maxAgeMs) return null;
    unlinkSync(lockPath);
    return lockPath;
  } catch {
    // Best-effort — leave it for the user if we can't remove it.
    return null;
  }
}

/** Clear stale `index.lock` files across one or more resolved gitdirs. */
export function clearStaleIndexLocks(
  gitDirs: string[],
  maxAgeMs: number = STALE_INDEX_LOCK_MS,
): string[] {
  const now = Date.now();
  const removed: string[] = [];
  for (const dir of new Set(gitDirs)) {
    const cleared = clearStaleIndexLock(dir, maxAgeMs, now);
    if (cleared) removed.push(cleared);
  }
  return removed;
}
