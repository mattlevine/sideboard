import { useEffect, useState } from 'react';
import type { CaffeinateHoldState, Thread } from '@sideboard-ai/core';
import { isOrchestratorThread } from './global-workspace';

export type CaffeinateUiState = CaffeinateHoldState & { appCaffeinated: boolean };

/** Live caffeinate hold + whether the app is currently keeping the Mac awake. */
export function useCaffeinateHold(): CaffeinateUiState | null {
  const [state, setState] = useState<CaffeinateUiState | null>(null);

  useEffect(() => {
    const api = window.sideboard.getCaffeinateHold;
    if (!api) return;
    let cancelled = false;
    const apply = (next: CaffeinateHoldState & { appCaffeinated?: boolean }) => {
      if (cancelled) return;
      setState({
        ...next,
        appCaffeinated: Boolean(next.appCaffeinated),
      });
    };
    void api()
      .then(apply)
      .catch(() => undefined);
    const off = window.sideboard.onCaffeinateHoldChanged?.(apply);
    const id = window.setInterval(() => {
      void api()
        .then(apply)
        .catch(() => undefined);
    }, 4000);
    return () => {
      cancelled = true;
      off?.();
      window.clearInterval(id);
    };
  }, []);

  return state;
}

/** Show the awake badge on this chat tab (including inactive tabs). */
export function chatTabIsCaffeinated(
  chat: Pick<Thread, 'id' | 'sourceType' | 'repoPath'>,
  hold: Pick<CaffeinateHoldState, 'held' | 'threadIds'> | null | undefined,
  appCaffeinated = false,
): boolean {
  if (hold?.held && hold.threadIds.includes(chat.id)) return true;
  if (hold?.held && hold.threadIds.length === 0 && isOrchestratorThread(chat)) {
    return true;
  }
  if (appCaffeinated && isOrchestratorThread(chat)) {
    if (hold?.held && hold.threadIds.length > 0) {
      return hold.threadIds.includes(chat.id);
    }
    return true;
  }
  return false;
}
