import { useEffect, useRef, useState } from 'react';
import type { ClaudePlanUsage, Thread } from '@sideboard-ai/core';

/** Account-level Claude Code quota — any open worktree or orchestration chat. */
export function shouldShowClaudePlanUsage(
  thread: Pick<Thread, 'agent' | 'sourceType' | 'repoPath'> | null | undefined,
): boolean {
  return Boolean(thread);
}

/** After a reading exists, wait this long after nonce churn before refetching. */
export const CLAUDE_USAGE_DEBOUNCE_MS = 2_000;
export const CLAUDE_USAGE_POLL_MS = 120_000;

/** First paint is immediate; later status/message nonce changes coalesce. */
export function claudeUsageLoadDelay(hasReading: boolean): number {
  return hasReading ? CLAUDE_USAGE_DEBOUNCE_MS : 0;
}

/** Poll Claude Code plan windows while any chat is open. */
export function useClaudePlanUsage(
  enabled: boolean,
  refreshNonce: string | number,
): ClaudePlanUsage | null {
  const [usage, setUsage] = useState<ClaudePlanUsage | null>(null);
  const hasReading = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setUsage(null);
      hasReading.current = false;
      return;
    }
    let cancelled = false;
    const load = () => {
      void window.sideboard.getClaudeUsage().then(
        (next) => {
          if (cancelled) return;
          setUsage(next);
          if (next) hasReading.current = true;
        },
        () => {
          if (!cancelled) setUsage(null);
        },
      );
    };
    const timeout = window.setTimeout(load, claudeUsageLoadDelay(hasReading.current));
    const id = window.setInterval(load, CLAUDE_USAGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearInterval(id);
    };
  }, [enabled, refreshNonce]);

  return usage;
}
