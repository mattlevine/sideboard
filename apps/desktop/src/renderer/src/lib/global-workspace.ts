import type { Thread } from '@sideboard-ai/core';

/** Keep in sync with `@sideboard-ai/core` GLOBAL_WORKSPACE_ID / CLOUD_ORCHESTRATOR_GOAL. */
export const GLOBAL_WORKSPACE_ID = '__global__';
export const CLOUD_ORCHESTRATOR_GOAL = 'Cloud-connected Sideboard orchestrator';

export function isGlobalThread(
  thread: Pick<Thread, 'repoPath'> | null | undefined,
): boolean {
  return Boolean(thread && thread.repoPath === GLOBAL_WORKSPACE_ID);
}

export function isCloudCoordinatorThread(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title' | 'repoPath'>,
): boolean {
  if (thread.sourceRef === CLOUD_ORCHESTRATOR_GOAL) {
    return thread.repoPath === GLOBAL_WORKSPACE_ID || thread.sourceType === 'orchestration';
  }
  // Legacy: title was the cloud marker before soccer nicknames.
  if (thread.title === CLOUD_ORCHESTRATOR_GOAL) {
    return thread.repoPath === GLOBAL_WORKSPACE_ID || thread.sourceType === 'orchestration';
  }
  return false;
}

/** True for Global chats and legacy pinned-repo orchestration threads. */
export function isOrchestratorThread(
  thread: Pick<Thread, 'sourceType' | 'repoPath'> | null | undefined,
): boolean {
  return Boolean(
    thread &&
      (thread.sourceType === 'orchestration' || isGlobalThread(thread)),
  );
}

/** Short label for crowded UI (tabs, board rows). */
export function threadDisplayTitle(thread: Pick<Thread, 'title' | 'sourceType' | 'sourceRef'>): string {
  return thread.title?.trim() || 'Untitled';
}
