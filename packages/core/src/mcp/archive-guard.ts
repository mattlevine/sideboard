import { isCloudCoordinatorThread } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';

/** Non-null when MCP must refuse archive_thread for this thread. */
export function mcpArchiveBlockedReason(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title'>,
): string | null {
  if (isCloudCoordinatorThread(thread)) {
    return 'Refusing to archive the cloud coordinator via MCP. Archive it from the Sideboard UI if needed.';
  }
  return null;
}
