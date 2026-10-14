import { isOrchestratorThread } from '../store/global-workspace.js';
import type { Thread } from '../types/thread.js';

type ConnectedNode = Pick<Thread, 'id' | 'parentThreadId' | 'sourceType' | 'repoPath'>;

/**
 * Orchestration chat this agent is connected to. Walks parent links so a
 * forked agent whose parent is a sibling still finds the orchestrator.
 * An orchestration chat has no parent orchestrator of its own.
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
