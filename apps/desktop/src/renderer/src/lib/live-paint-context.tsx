import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import {
  createLivePaintStore,
  EMPTY_LIVE_THREAD,
  type LivePaintStore,
  type LiveThreadSnapshot,
} from './live-paint-store';

const fallbackStore = createLivePaintStore();
const LivePaintContext = createContext<LivePaintStore>(fallbackStore);

export function LivePaintProvider({
  store,
  children,
}: {
  store: LivePaintStore;
  children: ReactNode;
}) {
  return <LivePaintContext.Provider value={store}>{children}</LivePaintContext.Provider>;
}

/** Subscribe to one thread's live stream. Other threads' chunks do not re-render. */
export function useLiveThread(threadId: string): LiveThreadSnapshot {
  const store = useContext(LivePaintContext);
  return useSyncExternalStore(
    (onStoreChange) => store.subscribeThread(threadId, onStoreChange),
    () => store.getThread(threadId),
    () => EMPTY_LIVE_THREAD,
  );
}
