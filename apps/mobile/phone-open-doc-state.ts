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

export type PlacedOpenReply = {
  state: OpenDocsState;
  id: string;
  /** Previous tab id when the Mac's path renamed the open. */
  replacedId: string | null;
};

/**
 * Chat paths and the Mac's worktree-relative path often differ (`./`, a hash,
 * `file://`, or an absolute path under the worktree). Compare those shapes
 * without treating `other/apps/foo.ts` as `apps/foo.ts`. An absolute path that
 * merely ends with the relative path is a candidate; the closest open tab wins.
 */
export function looseOpenPath(raw: string): string {
  let text = raw.trim();
  if (!text) return '';
  if (/^file:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      return '';
    }
  }
  const hash = text.indexOf('#');
  if (hash >= 0) text = text.slice(0, hash);
  return text.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Lower is a tighter path. Exact equality beats a longer absolute suffix. */
function openPathScore(path: string, canonicalPath: string): number | null {
  const raw = looseOpenPath(path);
  const canon = looseOpenPath(canonicalPath);
  if (!raw || !canon) return null;
  if (raw === canon) return 0;
  if (raw.startsWith('/') && raw.endsWith(`/${canon}`)) return raw.length;
  return null;
}

export function sameOpenFile(requestedPath: string, canonicalPath: string): boolean {
  return openPathScore(requestedPath, canonicalPath) != null;
}

function filePathFromDocId(id: string): string | null {
  const prefix = 'file:';
  if (!id.startsWith(prefix)) return null;
  return id.slice(prefix.length);
}

/**
 * Tab this file reply belongs on. Among suffix matches, the shortest path
 * wins so `…/other/apps/foo.ts` does not take a reply for `apps/foo.ts`.
 * A tie prefers the non-canonical id so an in-flight tab can be renamed.
 */
function matchingFileDocId(state: OpenDocsState, canonicalPath: string): string | null {
  const canonical = fileDocId(canonicalPath);
  const ids = [state.requestedId, ...state.docs.map((doc) => doc.id)].filter((id): id is string => Boolean(id));
  let best: { id: string; score: number } | null = null;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const path = filePathFromDocId(id);
    if (!path) continue;
    const score = openPathScore(path, canonicalPath);
    if (score == null) continue;
    const closer = !best || score < best.score;
    const renameTie = best != null && score === best.score && id !== canonical && best.id === canonical;
    if (closer || renameTie) best = { id, score };
  }
  return best?.id ?? null;
}

function retargetOpenDoc(state: OpenDocsState, fromId: string, toId: string): OpenDocsState {
  if (fromId === toId) return state;
  const targetExists = state.docs.some((doc) => doc.id === toId);
  const docs = state.docs.flatMap((doc) => {
    if (doc.id !== fromId) return [doc];
    if (targetExists) return [];
    return [{ ...doc, id: toId }];
  });
  return {
    docs,
    activeId: state.activeId === fromId ? toId : state.activeId,
    requestedId: state.requestedId === fromId ? toId : state.requestedId,
  };
}

/**
 * Attach a Mac reply to the tab that asked for it.
 * A file reply whose path was normalized on the Mac renames that tab to the
 * worktree-relative id. A reply for a file the user already closed is dropped.
 */
export function placeOpenReply(state: OpenDocsState, viewer: PhoneViewerModel): PlacedOpenReply | null {
  if (viewer.status !== 'file') {
    const id = docIdForViewer(viewer, state.requestedId);
    if (!id) return null;
    const next = writeOpenDoc(state, id, viewer, true);
    if (next === state) return null;
    return { state: next, id, replacedId: null };
  }
  const match = matchingFileDocId(state, viewer.path);
  if (!match) return null;
  const canonical = fileDocId(viewer.path);
  const base = retargetOpenDoc(state, match, canonical);
  return {
    state: writeOpenDoc(base, canonical, viewer, true),
    id: canonical,
    replacedId: match === canonical ? null : match,
  };
}
