import { useEffect, useRef, useState } from 'react';

export type WorktreeDiffStat = {
  additions: number;
  deletions: number;
  dirty: boolean;
};

/** Statuses that mean the agent is done writing — reload the dirty glyph. */
const RELOAD_ON_STATUS = new Set(['idle', 'error', 'stopped', 'broken']);

/**
 * Uncommitted dirty stat for a sidebar/board worktree row.
 * Skips git while the agent is queued/running so a 5-worktree fan-out
 * does not stampede `getDiff` on every status tick.
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

  useEffect(() => {
    prevStatus.current = null;
    let cancelled = false;
    const load = async () => {
      const gen = ++fetchGen.current;
      try {
        const diff = await window.sideboard.getDiff(threadId, {
          scope: 'uncommitted',
          includePatches: false,
        });
        if (cancelled || gen !== fetchGen.current) return;
        const s = diff.scopeStats?.uncommitted;
        setStat({
          additions: s?.additions ?? 0,
          deletions: s?.deletions ?? 0,
          dirty: Boolean(diff.dirty) || (s != null && (s.additions > 0 || s.deletions > 0)),
        });
        setLoaded(true);
      } catch {
        if (cancelled || gen !== fetchGen.current) return;
        setStat({ additions: 0, deletions: 0, dirty: false });
        setLoaded(true);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 12_000);
    return () => {
      cancelled = true;
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
        .getDiff(threadId, { scope: 'uncommitted', includePatches: false })
        .then((diff) => {
          if (cancelled || gen !== fetchGen.current) return;
          const s = diff.scopeStats?.uncommitted;
          setStat({
            additions: s?.additions ?? 0,
            deletions: s?.deletions ?? 0,
            dirty: Boolean(diff.dirty) || (s != null && (s.additions > 0 || s.deletions > 0)),
          });
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
