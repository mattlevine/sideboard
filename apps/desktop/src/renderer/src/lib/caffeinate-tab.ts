import type { CaffeinateHoldState, Thread } from '@sideboard-ai/core';
import { isOrchestratorThread } from './global-workspace';

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
