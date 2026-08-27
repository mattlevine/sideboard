import type { Thread } from '@sideboard-ai/core';

export type ThreadLists = {
  threads: Thread[];
  archived: Thread[];
};

/** Merge one fetched thread into the board lists (or drop it if deleted). */
export function applyThreadToLists(
  state: ThreadLists,
  thread: Thread | null,
  id: string,
): ThreadLists {
  const drop = (list: Thread[]) => list.filter((t) => t.id !== id);
  if (!thread) {
    return { threads: drop(state.threads), archived: drop(state.archived) };
  }
  const upsert = (list: Thread[]) => {
    const i = list.findIndex((t) => t.id === thread.id);
    if (i < 0) return [...list, thread];
    const next = list.slice();
    next[i] = thread;
    return next;
  };
  if (thread.status === 'archived') {
    return { threads: drop(state.threads), archived: upsert(state.archived) };
  }
  return { threads: upsert(state.threads), archived: drop(state.archived) };
}

export type ThreadRefreshReason = 'full' | 'status';

/**
 * Coalesce board reloads. Status/queue/create storms share one full refresh;
 * a burst of single-id patches flush together after `debounceMs`.
 */
export function createThreadRefreshScheduler(opts: {
  refreshAll: () => void;
  refreshOne: (threadId: string) => void;
  debounceMs?: number;
}): {
  schedule(reason: ThreadRefreshReason, threadId?: string): void;
  dispose(): void;
} {
  const debounceMs = opts.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingFull = false;
  const pendingIds = new Set<string>();

  const flush = () => {
    timer = null;
    if (pendingFull) {
      pendingFull = false;
      pendingIds.clear();
      opts.refreshAll();
      return;
    }
    const ids = [...pendingIds];
    pendingIds.clear();
    for (const id of ids) opts.refreshOne(id);
  };

  const arm = () => {
    if (timer != null) return;
    timer = setTimeout(flush, debounceMs);
  };

  return {
    schedule(reason, threadId) {
      if (reason === 'full' || !threadId) {
        pendingFull = true;
      } else {
        pendingIds.add(threadId);
      }
      arm();
    },
    dispose() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      pendingFull = false;
      pendingIds.clear();
    },
  };
}
