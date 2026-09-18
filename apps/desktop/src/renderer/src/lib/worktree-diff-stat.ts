import { useEffect, useRef, useState } from 'react';
import type { WorktreeDirtyStat } from '@sideboard-ai/core';

export type { WorktreeDirtyStat };

/** Statuses that mean the agent is done writing — reload the dirty glyph. */
const RELOAD_ON_STATUS = new Set(['idle', 'error', 'stopped', 'broken']);
const BUSY_STATUS = new Set(['queued', 'running']);

/** Let `git worktree add` / fetch finish before the first porcelain. */
const CREATE_DEFER_MS = 1_500;

const CLEAN: WorktreeDirtyStat = { additions: 0, deletions: 0, dirty: false };

/**
 * Uncommitted dirty stat for a sidebar/board worktree row.
 * Uses the cheap glyph IPC — not full `getDiff` (merge-base + PR-vs-main
 * + untracked walk). The first fetch is deferred so a pair of review-PR
 * creates does not stampede the repo lock; when the row mounts while the
 * agent is already queued/running it paints once immediately (last count
 * on remount) and the periodic reload waits for the turn to end.
 */
export function useWorktreeDirtyStat(
  threadId: string,
  worktreePath: string,
  status: string,
): { stat: WorktreeDirtyStat | null; loaded: boolean } {
  const [stat, setStat] = useState<WorktreeDirtyStat | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchGen = useRef(0);
  const prevStatus = useRef<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    prevStatus.current = null;
    let cancelled = false;
    const load = async (opts?: { skipWhenBusy?: boolean }) => {
      if (opts?.skipWhenBusy && BUSY_STATUS.has(statusRef.current)) return;
      const gen = ++fetchGen.current;
      try {
        const next = await window.sideboard.getWorktreeDirtyStat(threadId);
        if (cancelled || gen !== fetchGen.current) return;
        setStat(next);
        setLoaded(true);
      } catch {
        if (cancelled || gen !== fetchGen.current) return;
        setStat(CLEAN);
        setLoaded(true);
      }
    };
    // First paint: one fetch after the create window, even mid-turn, so a
    // remounted row shows its count instead of "…" for the whole turn.
    const first = window.setTimeout(() => void load(), CREATE_DEFER_MS);
    // Periodic: skip while the agent is writing — the status effect below
    // reloads once the turn ends.
    const interval = window.setInterval(
      () => void load({ skipWhenBusy: true }),
      12_000,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [threadId, worktreePath]);

  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    // First paint already loaded via the id/path effect — only refetch after
    // a turn actually ends (queued/running → idle/error/…).
    if (prev == null || prev === status || !RELOAD_ON_STATUS.has(status)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const gen = ++fetchGen.current;
      void window.sideboard
        .getWorktreeDirtyStat(threadId)
        .then((next) => {
          if (cancelled || gen !== fetchGen.current) return;
          setStat(next);
          setLoaded(true);
        })
        .catch(() => {
          if (cancelled || gen !== fetchGen.current) return;
          setStat(CLEAN);
          setLoaded(true);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, threadId, worktreePath]);

  return { stat, loaded };
}
