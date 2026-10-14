import type { Thread } from '@sideboard-ai/core';
import { isOrchestratorThread } from './global-workspace';

type ConnectedNode = Pick<Thread, 'id' | 'parentThreadId' | 'sourceType' | 'repoPath'>;

/**
 * Orchestration chat this agent is connected to. Same walk as
 * `packages/core/src/threads/connected-orchestrator.ts` (renderer cannot import
 * that module). A forked agent whose parent is a sibling still finds it.
 */
export function connectedOrchestrator<T extends ConnectedNode>(
  thread: T,
  find: (id: string) => T | null | undefined,
): T | null {
  if (isOrchestratorThread(thread)) return null;
  const seen = new Set<string>();
  let current: T | null | undefined = thread;
  for (let hop = 0; hop < 6 && current; hop++) {
    const parentId = current.parentThreadId?.trim();
    if (!parentId || seen.has(parentId)) return null;
    seen.add(parentId);
    const parent = find(parentId);
    if (!parent) return null;
    if (isOrchestratorThread(parent)) return parent;
    current = parent;
  }
  return null;
}
