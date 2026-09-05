/**
 * Workspace setup runs in parallel with the first agent turn. A non-zero
 * setup exit must not become thread lastError while that turn is live —
 * Claude is already in tool_use by the time install scripts finish, so
 * "Setup exited 1" paints over a healthy stream. Cursor's slower spawn
 * already wipes lastError at spawn-complete; this keeps Claude (and
 * manual Run setup) from re-stamping it mid-turn. Output still goes to
 * the Setup panel via setup_finished.
 *
 * Batch create is the other false-red case: several worktrees start at
 * once, setup races (install locks, ports), and the first prompt is still
 * queued behind the concurrency cap — status is idle/queued, not running.
 * Do not stamp then either.
 */
export function shouldStampSetupLastError(opts: {
  turnInFlight: boolean;
  status?: string | null;
  hasQueuedPrompt?: boolean;
}): boolean {
  if (opts.turnInFlight) return false;
  if (opts.status === 'running' || opts.status === 'queued') return false;
  if (opts.hasQueuedPrompt) return false;
  return true;
}

/** Setup panel already has the log — this string is leftover thread chrome. */
export function isSetupLastError(err: string | null | undefined): boolean {
  return /^Setup (exited|failed)\b/i.test(err?.trim() ?? '');
}

/** lastError that is not this turn failing — wipe while we still own the turn. */
export function isStaleLastErrorDuringTurn(err: string | null | undefined): boolean {
  return Boolean(err?.trim());
}
