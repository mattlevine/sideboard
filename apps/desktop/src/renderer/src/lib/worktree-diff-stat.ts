import { useEffect, useRef, useState } from 'react';

export type WorktreeDiffStat = {
  additions: number;
  deletions: number;
  dirty: boolean;
};

/** Statuses that mean the agent is done writing — reload the dirty glyph. */
const RELOAD_ON_STATUS = new Set(['idle', 'error', 'stopped', 'broken']);
const BUSY_STATUS = new Set(['queued', 'running']);

/** Let `git worktree add` / fetch finish before the first porcelain. */
const CREATE_DEFER_MS = 1_500;

/**
 * Uncommitted dirty stat for a sidebar/board worktree row.
 * Uses the cheap glyph IPC — not full `getDiff` (merge-base + PR-vs-main
 * + untracked walk). Skips git while queued/running, and defers the first
 * fetch so a pair of review-PR creates does not stampede the repo lock.
 */
export function useWorktreeDirtyStat(
  threadId: string,
  worktreePath: string,
  status: string,
): { stat: WorktreeDiffStat | null; loaded: boolean } {
  const [stat, setStat] = useState<WorktreeDiffStat | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchGen = useRef(0);
  const prevStatus = useRef<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    prevStatus.current = null;
    let cancelled = false;
    const load = async () => {
      if (BUSY_STATUS.has(statusRef.current)) return;
      const gen = ++fetchGen.current;
      try {
        const next = await window.sideboard.getWorktreeDirtyStat(threadId);
        if (cancelled || gen !== fetchGen.current) return;
        setStat(next);
        setLoaded(true);
      } catch {
        if (cancelled || gen !== fetchGen.current) return;
        setStat({ additions: 0, deletions: 0, dirty: false });
        setLoaded(true);
      }
    };
    const first = window.setTimeout(() => void load(), CREATE_DEFER_MS);
    const interval = window.setInterval(() => void load(), 12_000);
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
          setStat({ additions: 0, deletions: 0, dirty: false });
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
