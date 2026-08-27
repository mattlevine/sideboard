import type { MessagePart, TokenUsage } from '@sideboard-ai/core';
import { foldLivePaintOps, type LivePaintOp, type LivePaintState } from './live-paint';

/** Stable empty parts — a new `[]` each read would retrigger chat auto-scroll. */
export const EMPTY_LIVE_PARTS: MessagePart[] = [];

export type LiveThreadSnapshot = {
  output: string;
  parts: MessagePart[];
  startedAt: number | undefined;
  usage: TokenUsage | null | undefined;
};

export const EMPTY_LIVE_THREAD: LiveThreadSnapshot = {
  output: '',
  parts: EMPTY_LIVE_PARTS,
  startedAt: undefined,
  usage: undefined,
};

export type LivePaintStore = {
  apply(ops: LivePaintOp[], now?: number): void;
  getThread(threadId: string): LiveThreadSnapshot;
  subscribeThread(threadId: string, listener: () => void): () => void;
};

/**
 * Per-thread live stream store. Applying ops notifies only listeners for
 * threads that changed, so the board shell / sidebar do not re-render at
 * stream frame rate.
 */
export function createLivePaintStore(): LivePaintStore {
  let state: LivePaintState = {
    output: {},
    parts: {},
    startedAt: {},
    usage: {},
  };
  const snapshots = new Map<string, LiveThreadSnapshot>();
  const threadListeners = new Map<string, Set<() => void>>();

  function notify(threadId: string): void {
    const set = threadListeners.get(threadId);
    if (!set) return;
    for (const listener of set) listener();
  }

  return {
    apply(ops, now = Date.now()) {
      if (ops.length === 0) return;
      state = foldLivePaintOps(state, ops, now);
      const changed = new Set(ops.map((op) => op.threadId));
      for (const threadId of changed) {
        snapshots.set(threadId, {
          output: state.output[threadId] ?? '',
          parts: state.parts[threadId] ?? EMPTY_LIVE_PARTS,
          startedAt: state.startedAt[threadId],
          usage: state.usage[threadId],
        });
        notify(threadId);
      }
    },
    getThread(threadId) {
      return snapshots.get(threadId) ?? EMPTY_LIVE_THREAD;
    },
    subscribeThread(threadId, listener) {
      let set = threadListeners.get(threadId);
      if (!set) {
        set = new Set();
        threadListeners.set(threadId, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) threadListeners.delete(threadId);
      };
    },
  };
}
