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

/** Put the open chat's full transcript back after a slim list reload. */
export function mergeFullThreadIntoLists(
  state: ThreadLists,
  full: Thread | null,
): ThreadLists {
  if (!full) return state;
  return applyThreadToLists(state, full, full.id);
}

/**
 * Keep the newest full transcript. An in-flight older `getThread` must not
 * replace a live stream or a later refresh (updatedAt, then message count).
 */
export function isFresherFullThread(prev: Thread | undefined, next: Thread): boolean {
  if (!prev) return true;
  const prevTs = Date.parse(prev.updatedAt) || 0;
  const nextTs = Date.parse(next.updatedAt) || 0;
  if (nextTs !== prevTs) return nextTs > prevTs;
  if (next.messages.length !== prev.messages.length) {
    return next.messages.length > prev.messages.length;
  }
  return true;
}

/** Skip React setState when a slim/full refresh did not change list identity. */
export function threadListsUnchanged(a: ThreadLists, b: ThreadLists): boolean {
  return listSignature(a.threads) === listSignature(b.threads)
    && listSignature(a.archived) === listSignature(b.archived);
}

function listSignature(list: Thread[]): string {
  return list
    .map((t) => `${t.id}:${t.updatedAt}:${t.status}:${t.messages.length}`)
    .join('\n');
}

/**
 * Ids that were live before a live-only `getThreads(false)` pass but are not
 * in the new list — archived elsewhere (desktop, MCP, auto-archive on merge).
 * Caller refetches each one so the archived list does not go stale until
 * Settings → History forces a full pass.
 */
export function vanishedLiveThreadIds(prevLive: Thread[], nextLive: Thread[]): string[] {
  const next = new Set(nextLive.map((t) => t.id));
  return prevLive.filter((t) => !next.has(t.id)).map((t) => t.id);
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
