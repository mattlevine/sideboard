import { useEffect, useState } from 'react';
import type { ClaudePlanUsage, Thread } from '@sideboard-ai/core';

/** Account-level Claude Code quota — any open worktree or orchestration chat. */
export function shouldShowClaudePlanUsage(
  thread: Pick<Thread, 'agent' | 'sourceType' | 'repoPath'> | null | undefined,
): boolean {
  return Boolean(thread);
}

/** Poll Claude Code plan windows while any chat is open. */
export function useClaudePlanUsage(
  enabled: boolean,
  refreshNonce: string | number,
): ClaudePlanUsage | null {
  const [usage, setUsage] = useState<ClaudePlanUsage | null>(null);

  useEffect(() => {
    if (!enabled) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void window.sideboard.getClaudeUsage().then(
        (next) => {
          if (!cancelled) setUsage(next);
        },
        () => {
          if (!cancelled) setUsage(null);
        },
      );
    };
    load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, refreshNonce]);

  return usage;
}
