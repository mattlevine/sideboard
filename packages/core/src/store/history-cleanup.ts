import type { Thread } from '../types/thread.js';
import {
  autoCleanupHistoryEnabled,
  historyMaxCount,
  historyMaxDays,
  loadAppSettings,
  updateAdvancedSettings,
} from './app-settings.js';
import {
  HISTORY_CLEANUP_INTERVAL_HOURS_DEFAULT,
  historyRetentionStubMessage,
  planHistoryAgePurge,
  planHistoryRetention,
} from './history-retention.js';
import { deleteThreadRecord, listThreads, readThread, writeThread } from './thread-store.js';

export interface HistoryCleanupResult {
  stripped: string[];
  purged: string[];
}

export interface CleanupArchivedHistoryOpts {
  dryRun?: boolean;
  maxCount?: number;
  maxDays?: number;
  /** Manual prune from Settings → History (ignores the auto toggle). */
  purgeOlderThanDays?: number;
  /** Run even when Settings → Limit History is off. */
  force?: boolean;
  nowMs?: number;
}

function stripArchivedTranscript(thread: Thread): void {
  writeThread(
    {
      ...thread,
      attachments: [],
      pendingTurnAttachments: [],
      queueAttachments: [],
      messages: [historyRetentionStubMessage(thread)],
    },
    { touch: false },
  );
}

/**
 * Bound Settings → History. Age-expired rows are deleted. Count overflow is
 * stripped first, then deleted on a later pass. Never deletes git branches.
 */
export function cleanupArchivedHistory(
  opts: CleanupArchivedHistoryOpts = {},
): HistoryCleanupResult {
  const settings = loadAppSettings();
  if (!opts.force && opts.purgeOlderThanDays == null && !autoCleanupHistoryEnabled(settings)) {
    return { stripped: [], purged: [] };
  }

  const archived = listThreads({ includeArchived: true }).filter((t) => t.status === 'archived');
  const nowMs = opts.nowMs ?? Date.now();

  const plan =
    opts.purgeOlderThanDays != null
      ? { stripIds: [], purgeIds: planHistoryAgePurge(archived, opts.purgeOlderThanDays, nowMs) }
      : planHistoryRetention(archived, {
          maxCount: opts.maxCount ?? historyMaxCount(settings),
          maxDays: opts.maxDays ?? historyMaxDays(settings),
          nowMs,
        });

  const stripped: string[] = [];
  const purged: string[] = [];

  if (opts.dryRun) {
    return { stripped: plan.stripIds, purged: plan.purgeIds };
  }

  for (const id of plan.stripIds) {
    const thread = readThread(id);
    if (!thread || thread.status !== 'archived') continue;
    try {
      stripArchivedTranscript(thread);
      stripped.push(id);
    } catch {
      // Leave the row for the next pass.
    }
  }

  for (const id of plan.purgeIds) {
    const thread = readThread(id);
    if (!thread || thread.status !== 'archived') continue;
    try {
      deleteThreadRecord(id);
      purged.push(id);
    } catch {
      // Leave the row for the next pass.
    }
  }

  if (stripped.length > 0 || purged.length > 0) {
    updateAdvancedSettings({
      historyLastCleanupAt: new Date(nowMs).toISOString(),
    });
  }

  return { stripped, purged };
}

export function shouldRunHistoryCleanup(
  settings = loadAppSettings(),
): boolean {
  if (!autoCleanupHistoryEnabled(settings)) return false;
  const intervalHours =
    settings.advanced.historyCleanupIntervalHours ?? HISTORY_CLEANUP_INTERVAL_HOURS_DEFAULT;
  const last = settings.advanced.historyLastCleanupAt;
  if (!last) return true;
  const elapsed = Date.now() - Date.parse(last);
  return Number.isFinite(elapsed) && elapsed >= intervalHours * 3_600_000;
}
