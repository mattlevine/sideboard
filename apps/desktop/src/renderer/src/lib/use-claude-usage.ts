import { useEffect, useState } from 'react';
import type { ClaudePlanUsage, Thread } from '@sideboard-ai/core';
import { isOrchestratorThread } from './global-workspace';

/** Worktree Claude chats, plus every Global / orchestration chat (account-level quota). */
export function shouldShowClaudePlanUsage(
  thread: Pick<Thread, 'agent' | 'sourceType' | 'repoPath'> | null | undefined,
): boolean {
  if (!thread) return false;
  return thread.agent === 'claude' || isOrchestratorThread(thread);
}

/** Poll Claude Code plan windows while a Claude or orchestration chat is open. */
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
