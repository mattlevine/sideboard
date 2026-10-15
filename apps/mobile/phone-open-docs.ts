import { useRef, useState } from 'react';
import type { PhoneViewerModel } from './phone-viewer';
import {
  beginOpenDoc,
  closeOpenDoc,
  emptyOpenDocs,
  openingViewer,
  placeOpenReply,
  selectOpenDoc,
  writeOpenDoc,
  type OpenDocsState,
} from './phone-open-doc-state';

export {
  artifactDocId,
  beginOpenDoc,
  closeOpenDoc,
  docIdForViewer,
  emptyOpenDocs,
  fileDocId,
  looseOpenPath,
  openDocLabel,
  openingViewer,
  placeOpenReply,
  sameOpenFile,
  selectOpenDoc,
  writeOpenDoc,
  type OpenDocsState,
  type PhoneOpenDoc,
  type PlacedOpenReply,
} from './phone-open-doc-state';

const OPEN_TIMEOUT_MS = 12_000;
const OPEN_TIMEOUT_MESSAGE =
  'The Mac did not send this. Update Sideboard on the Mac so the phone can show it.';

export function usePhoneOpenDocs() {
  const [state, setState] = useState(emptyOpenDocs);
  const stateRef = useRef(state);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  stateRef.current = state;

  function commit(next: OpenDocsState) {
    stateRef.current = next;
    setState(next);
  }

  function clearTimer(id: string) {
    const timer = timers.current.get(id);
    if (!timer) return;
    clearTimeout(timer);
    timers.current.delete(id);
  }

  function showOpening(id: string, title: string) {
    clearTimer(id);
    commit(beginOpenDoc(stateRef.current, id, title));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        const row = stateRef.current.docs.find((doc) => doc.id === id);
        if (row?.viewer.status !== 'loading') return;
        commit(
          writeOpenDoc(
            stateRef.current,
            id,
            { status: 'error', title: row.viewer.title, message: OPEN_TIMEOUT_MESSAGE },
            false,
          ),
        );
      }, OPEN_TIMEOUT_MS),
    );
  }

  function apply(viewer: PhoneViewerModel) {
    const placed = placeOpenReply(stateRef.current, viewer);
    if (!placed) return;
    clearTimer(placed.id);
    if (placed.replacedId) clearTimer(placed.replacedId);
    commit(placed.state);
  }

  function close(id: string): string | null {
    clearTimer(id);
    const next = closeOpenDoc(stateRef.current, id);
    commit(next);
    return next.activeId;
  }

  function closeAll() {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    commit(emptyOpenDocs());
  }

  function select(id: string) {
    commit(selectOpenDoc(stateRef.current, id));
  }

  function current(): PhoneViewerModel | null {
    return openingViewer(stateRef.current);
  }

  return {
    docs: state.docs,
    activeId: state.activeId,
    showOpening,
    apply,
    close,
    closeAll,
    select,
    current,
  };
}
