import { readThread, setStatus } from '../store/thread-store.js';
import type { Thread } from '../types/thread.js';

/** Cap so a stop note stays a label, not a transcript. */
const STOP_REASON_MAX = 500;

/**
 * Why a turn was stopped. An explicit note wins. Otherwise the stop kind
 * is the record: Send now, the desktop Stop button, or a force-stop that
 * clears the queue.
 */
export function resolveStopReason(opts?: {
  clearQueue?: boolean;
  continueQueue?: boolean;
  reason?: string | null;
}): string {
  const explicit = opts?.reason?.trim();
  if (explicit) return explicit.slice(0, STOP_REASON_MAX);
  if (opts?.continueQueue) return 'Stopped to send the next prompt';
  if (opts?.clearQueue === false) return 'Stopped by the user';
  return 'Stopped (queue cleared)';
}

/** Canned stop labels. A real failure note (context limit, and so on) is not one of these. */
export function isRoutineStopNote(err: string | null | undefined): boolean {
  const text = err?.trim() ?? '';
  return (
    text === 'Stopped' ||
    text === 'Stopped by the user' ||
    text === 'Stopped (queue cleared)' ||
    text === 'Stopped to send the next prompt'
  );
}

/**
 * Keep a stop note across the turn unwind. A later status write with no
 * new reason must not wipe the one `stop()` just stored.
 */
export function reasonToKeepOnStop(
  existing: string | null | undefined,
  incoming?: string | null,
): string {
  const next = incoming?.trim();
  if (next) return next.slice(0, STOP_REASON_MAX);
  const prior = existing?.trim();
  if (prior) return prior.slice(0, STOP_REASON_MAX);
  return 'Stopped';
}

/** Mark a thread stopped and keep the note across the later turn unwind. */
export function writeStoppedStatus(threadId: string, reason?: string | null): Thread | null {
  const latest = readThread(threadId);
  if (!latest || latest.status === 'archived') return latest;
  return setStatus(threadId, 'stopped', reasonToKeepOnStop(latest.lastError, reason));
}
