import type { Thread } from '@sideboard/core';

/** Keep in sync with `@sideboard/core` GLOBAL_WORKSPACE_ID / CLOUD_ORCHESTRATOR_GOAL. */
export const GLOBAL_WORKSPACE_ID = '__global__';
export const CLOUD_ORCHESTRATOR_GOAL = 'Cloud-connected Sideboard orchestrator';

export function isGlobalThread(
  thread: Pick<Thread, 'repoPath'> | null | undefined,
): boolean {
  return Boolean(thread && thread.repoPath === GLOBAL_WORKSPACE_ID);
}

export function isCloudCoordinatorThread(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title'>,
): boolean {
  return (
    thread.sourceType === 'orchestration' &&
    (thread.sourceRef === CLOUD_ORCHESTRATOR_GOAL ||
      thread.title === CLOUD_ORCHESTRATOR_GOAL)
  );
}

/** Short label for crowded UI (tabs, board rows). */
export function threadDisplayTitle(thread: Pick<Thread, 'title' | 'sourceType' | 'sourceRef'>): string {
  if (isCloudCoordinatorThread(thread)) return 'Cloud coordinator';
  return thread.title;
}
