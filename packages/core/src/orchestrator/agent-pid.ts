import { execFileSync } from 'node:child_process';

/** Process start stamp from `ps`. Compared later so a recycled pid is not signaled. */
export function pidStartedAt(pid: number): string | null {
  if (!Number.isFinite(pid) || pid <= 0 || process.platform === 'win32') return null;
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * True when this pid is still the process we recorded.
 * Missing stamp (older threads) keeps the previous pid-only check.
 * If `ps` fails, do not block a stop of a pid we believe is ours.
 */
export function isSameAgentProcess(
  pid: number,
  startedAt: string | null | undefined,
  alive: boolean,
): boolean {
  if (!alive) return false;
  if (!startedAt) return true;
  const now = pidStartedAt(pid);
  if (!now) return true;
  return now === startedAt;
}

/** True when `kill(pid, 0)` succeeds (process exists and is signalable). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait until pid exits, or `timeoutMs` elapses. */
export async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (isPidAlive(pid)) {
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 80));
  }
  return true;
}
