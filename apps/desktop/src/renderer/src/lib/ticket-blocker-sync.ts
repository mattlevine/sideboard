import { useEffect, useMemo, useRef } from 'react';
import type { Thread } from '@sideboard-ai/core';
import { newOpenPrSyncIds, openPrWorktreesFromKey } from './follow-thread-pr';
import { isGlobalThread } from './global-workspace';

/** Poll source tickets so the sidebar and Home can show "Blocked by …". */
export function useTicketBlockerSync(threads: Thread[]): void {
  const seen = useRef(new Set<string>());
  const ticketSyncKey = useMemo(() => {
    return threads
      .filter(
        (t) =>
          !isGlobalThread(t) &&
          t.status !== 'archived' &&
          t.sourceType === 'ticket' &&
          Boolean(t.sourceRef?.trim()),
      )
      .map((t) => `${t.id}:${(t.worktreePath || t.id).replace(/\/$/, '')}`)
      .sort()
      .join('|');
  }, [threads]);

  useEffect(() => {
    if (!ticketSyncKey) {
      seen.current.clear();
      return;
    }
    let cancelled = false;
    let running = false;

    async function syncTicketBlockers(mode: 'new' | 'all') {
      if (cancelled || running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const ids =
        mode === 'new'
          ? newOpenPrSyncIds(ticketSyncKey, seen.current)
          : openPrWorktreesFromKey(ticketSyncKey).map((row) => row.id);
      if (ids.length === 0) return;
      running = true;
      try {
        for (const id of ids) {
          if (cancelled) break;
          try {
            await window.sideboard.refreshIssueBlocked(id);
          } catch {
            // ignore per-thread failures (offline / ticket missing)
          }
        }
      } finally {
        running = false;
      }
    }

    void syncTicketBlockers('new');
    const onVis = () => {
      if (document.visibilityState === 'visible') void syncTicketBlockers('all');
    };
    document.addEventListener('visibilitychange', onVis);
    const interval = window.setInterval(() => void syncTicketBlockers('all'), 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(interval);
    };
  }, [ticketSyncKey]);
}
