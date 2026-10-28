import type { Thread } from '../types/thread.js';
import { archivedUpdatedMs } from '../store/history-retention.js';
import {
  deleteThreadRecord,
  listThreads,
  readThread,
  updateThread,
  withThreadLock,
} from '../store/thread-store.js';

/** Archived runs History keeps for one automation. */
export const EPHEMERAL_AUTOMATION_KEEP = 5;

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

/** Stamp a fresh automation chat and use the automation name as its title. */
export function markEphemeralAutomation(
  threadId: string,
  opts: { ephemeralAutomationId?: string; ephemeralTitle?: string },
): Thread {
  const id = opts.ephemeralAutomationId?.trim();
  const current = readThread(threadId);
  if (!current) throw new Error(`Thread not found: ${threadId}`);
  if (!id) return current;
  const title = opts.ephemeralTitle?.trim();
  return updateThread(threadId, {
    ephemeralAutomationId: id,
    ...(title ? { title, userSetTitle: true } : {}),
  });
}

/** Archive a finished one-off run and drop archived runs beyond the last five. */
export async function archiveEphemeralAutomationIfReady(
  threadId: string,
  archive: (id: string) => Promise<unknown>,
): Promise<void> {
  const keep = await withThreadLock(threadId, async () => {
    const thread = readThread(threadId);
    if (!thread || !ephemeralRunReadyToArchive(thread)) return null;
    const automationId = thread.ephemeralAutomationId?.trim();
    if (!automationId) return null;
    await archive(thread.id);
    // A failover sibling that already archived owns the run. Keeping this chat
    // would delete that sibling on the way out.
    return {
      automationId,
      keepId: archivedContinuationId(automationId, threadId) ?? threadId,
    };
  });
  if (keep) forgetOlderEphemeralRuns(keep.automationId, keep.keepId);
}

/** Failover sibling that already archived this one-off. */
function archivedContinuationId(automationId: string, sourceId: string): string | null {
  for (const thread of listThreads({ includeArchived: true })) {
    if (thread.id === sourceId || thread.status !== 'archived') continue;
    if (thread.ephemeralAutomationId !== automationId) continue;
    if (thread.quotaContinuedFromId !== sourceId) continue;
    return thread.id;
  }
  return null;
}

/** History restore keeps the chat. A later drain must not archive it again. */
export function clearEphemeralAutomation(threadId: string): void {
  const thread = readThread(threadId);
  if (!thread?.ephemeralAutomationId?.trim()) return;
  updateThread(threadId, { ephemeralAutomationId: undefined });
}

/**
 * Drop archived runs of the same automation beyond the newest
 * {@link EPHEMERAL_AUTOMATION_KEEP}. `keepId` stays even when it is older
 * (a failover continuation owns that run).
 */
export function forgetOlderEphemeralRuns(automationId: string, keepId: string): string[] {
  const id = automationId.trim();
  if (!id || !keepId) return [];
  const archived = listThreads({ includeArchived: true }).filter(
    (thread) => thread.status === 'archived' && thread.ephemeralAutomationId === id,
  );
  const ranked = [...archived].sort((a, b) => {
    if (a.id === keepId) return -1;
    if (b.id === keepId) return 1;
    return archivedUpdatedMs(b) - archivedUpdatedMs(a);
  });
  const keep = new Set(ranked.slice(0, EPHEMERAL_AUTOMATION_KEEP).map((thread) => thread.id));
  keep.add(keepId);
  const removed: string[] = [];
  for (const thread of archived) {
    if (keep.has(thread.id)) continue;
    try {
      deleteThreadRecord(thread.id);
      removed.push(thread.id);
    } catch {
      // Next archive retries.
    }
  }
  return removed;
}
