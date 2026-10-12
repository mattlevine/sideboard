import { useRef, useState } from 'react';
import type { PhoneViewerModel } from './phone-viewer';

/** A file or artifact the phone has opened, shown on the row under Chat / Files / Changes. */
export type PhoneOpenDoc = {
  id: string;
  viewer: PhoneViewerModel;
};

export type OpenDocsState = {
  docs: PhoneOpenDoc[];
  activeId: string | null;
  /** The open still waiting on the Mac. A late reply for a closed id is dropped. */
  requestedId: string | null;
};

const OPEN_TIMEOUT_MS = 12_000;
const OPEN_TIMEOUT_MESSAGE =
  'The Mac did not send this. Update Sideboard on the Mac so the phone can show it.';

export function emptyOpenDocs(): OpenDocsState {
  return { docs: [], activeId: null, requestedId: null };
}

export function fileDocId(path: string): string {
  return `file:${path}`;
}

export function artifactDocId(title: string): string {
  return `artifact:${title}`;
}

/** Tab label. Paths show the file name; artifact titles stay as they are. */
export function openDocLabel(title: string): string {
  const parts = title.split('/').filter(Boolean);
  return parts[parts.length - 1] || title;
}

export function beginOpenDoc(state: OpenDocsState, id: string, title: string): OpenDocsState {
  return {
    docs: upsertDoc(state.docs, { id, viewer: { status: 'loading', title } }),
    activeId: id,
    requestedId: id,
  };
}

/**
 * Store a Mac reply on its tab.
 * `completeRequest` clears the in-flight id when this reply is the one we asked for,
 * and focuses that tab only if the user has not moved to another open file.
 */
export function writeOpenDoc(
  state: OpenDocsState,
  id: string,
  viewer: PhoneViewerModel,
  completeRequest: boolean,
): OpenDocsState {
  const wanted = state.docs.some((doc) => doc.id === id) || state.requestedId === id;
  if (!wanted) return state;
  const done = completeRequest && state.requestedId === id;
  const focus = done && (state.activeId === id || state.activeId == null);
  return {
    docs: upsertDoc(state.docs, { id, viewer }),
    activeId: focus ? id : state.activeId,
    requestedId: done ? null : state.requestedId,
  };
}

export function docIdForViewer(viewer: PhoneViewerModel, requestedId: string | null): string | null {
  if (viewer.status === 'file') return fileDocId(viewer.path);
  if (viewer.status === 'artifact') return artifactDocId(viewer.title);
  return requestedId;
}

export function closeOpenDoc(state: OpenDocsState, id: string): OpenDocsState {
  const index = state.docs.findIndex((doc) => doc.id === id);
  const docs = state.docs.filter((doc) => doc.id !== id);
  const neighbor = docs[Math.min(Math.max(index, 0), docs.length - 1)];
  return {
    docs,
    activeId: state.activeId === id ? (neighbor?.id ?? null) : state.activeId,
    requestedId: state.requestedId === id ? null : state.requestedId,
  };
}

export function selectOpenDoc(state: OpenDocsState, id: string): OpenDocsState {
  if (!state.docs.some((doc) => doc.id === id)) return state;
  return { ...state, activeId: id };
}

/** Viewer the in-flight open should attach errors to, else the visible tab. */
export function openingViewer(state: OpenDocsState): PhoneViewerModel | null {
  const id = state.requestedId ?? state.activeId;
  if (!id) return null;
  return state.docs.find((doc) => doc.id === id)?.viewer ?? null;
}

function upsertDoc(docs: PhoneOpenDoc[], doc: PhoneOpenDoc): PhoneOpenDoc[] {
  const index = docs.findIndex((row) => row.id === doc.id);
  if (index < 0) return [...docs, doc];
  const next = docs.slice();
  next[index] = doc;
  return next;
}

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
    const id = docIdForViewer(viewer, stateRef.current.requestedId);
    if (!id) return;
    clearTimer(id);
    commit(writeOpenDoc(stateRef.current, id, viewer, true));
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
