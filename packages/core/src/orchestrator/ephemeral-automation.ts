import type { Thread } from '../types/thread.js';
import { deleteThreadRecord, listThreads } from '../store/thread-store.js';

/** Fresh automation chat with no continuing target. */
export function ephemeralRunReadyToArchive(
  thread: Pick<
    Thread,
    'ephemeralAutomationId' | 'status' | 'queue' | 'agentBlock' | 'quotaResumeAt'
  >,
): boolean {
  if (!thread.ephemeralAutomationId?.trim()) return false;
  if (thread.status !== 'idle' && thread.status !== 'error') return false;
  if (thread.queue.length > 0) return false;
  if (thread.agentBlock?.reason?.trim()) return false;
  if (thread.quotaResumeAt) return false;
  return true;
}

/** Drop earlier archived runs of the same automation. Keeps `keepId`. */
export function forgetOlderEphemeralRuns(automationId: string, keepId: string): string[] {
  const id = automationId.trim();
  if (!id || !keepId) return [];
  const removed: string[] = [];
  for (const thread of listThreads({ includeArchived: true })) {
    if (thread.id === keepId) continue;
    if (thread.status !== 'archived') continue;
    if (thread.ephemeralAutomationId !== id) continue;
    try {
      deleteThreadRecord(thread.id);
      removed.push(thread.id);
    } catch {
      // Next archive retries.
    }
  }
  return removed;
}
