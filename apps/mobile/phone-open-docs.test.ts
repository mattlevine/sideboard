import { describe, expect, it } from 'vitest';
import {
  artifactDocId,
  beginOpenDoc,
  closeOpenDoc,
  docIdForViewer,
  emptyOpenDocs,
  fileDocId,
  openDocLabel,
  selectOpenDoc,
  writeOpenDoc,
  type PhoneOpenDoc,
} from './phone-open-docs';
import type { PhoneViewerModel } from './phone-viewer';

function file(path: string): PhoneViewerModel {
  return { status: 'file', title: path, path, content: path, encoding: 'utf8' };
}

describe('phone open docs', () => {
  it('labels a path by its file name', () => {
    expect(openDocLabel('apps/mobile/App.tsx')).toBe('App.tsx');
    expect(openDocLabel('Notes')).toBe('Notes');
  });

  it('keeps each opened file and focuses the one just requested', () => {
    let state = emptyOpenDocs();
    state = beginOpenDoc(state, fileDocId('a.ts'), 'a.ts');
    state = writeOpenDoc(state, fileDocId('a.ts'), file('a.ts'), true);
    state = beginOpenDoc(state, fileDocId('dir/b.ts'), 'dir/b.ts');
    state = writeOpenDoc(state, fileDocId('dir/b.ts'), file('dir/b.ts'), true);
    expect(state.docs.map((doc) => doc.id)).toEqual([fileDocId('a.ts'), fileDocId('dir/b.ts')]);
    expect(state.activeId).toBe(fileDocId('dir/b.ts'));
    expect(state.requestedId).toBeNull();
  });

  it('fills an earlier file without leaving the one the user is waiting on', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('a.ts'), 'a.ts');
    state = beginOpenDoc(state, fileDocId('b.ts'), 'b.ts');
    state = writeOpenDoc(state, fileDocId('a.ts'), file('a.ts'), true);
    expect(state.activeId).toBe(fileDocId('b.ts'));
    expect(state.requestedId).toBe(fileDocId('b.ts'));
    expect(state.docs[0]?.viewer.status).toBe('file');
    expect(state.docs[1]?.viewer.status).toBe('loading');
  });

  it('does not reopen a file the user already closed', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('a.ts'), 'a.ts');
    state = closeOpenDoc(state, fileDocId('a.ts'));
    const next = writeOpenDoc(state, fileDocId('a.ts'), file('a.ts'), true);
    expect(next.docs).toEqual([]);
  });

  it('closes the visible file and selects the one beside it', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('a.ts'), 'a.ts');
    state = beginOpenDoc(state, fileDocId('b.ts'), 'b.ts');
    state = beginOpenDoc(state, fileDocId('c.ts'), 'c.ts');
    state = closeOpenDoc(state, fileDocId('a.ts'));
    expect(state.activeId).toBe(fileDocId('c.ts'));
    state = closeOpenDoc(state, fileDocId('c.ts'));
    expect(state.activeId).toBe(fileDocId('b.ts'));
    expect(state.docs.map((doc: PhoneOpenDoc) => doc.id)).toEqual([fileDocId('b.ts')]);
  });

  it('selects another open file without dropping the in-flight request', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('a.ts'), 'a.ts');
    state = writeOpenDoc(state, fileDocId('a.ts'), file('a.ts'), true);
    state = beginOpenDoc(state, fileDocId('b.ts'), 'b.ts');
    state = selectOpenDoc(state, fileDocId('a.ts'));
    state = writeOpenDoc(state, fileDocId('b.ts'), file('b.ts'), true);
    expect(state.activeId).toBe(fileDocId('a.ts'));
    expect(state.docs[1]?.viewer.status).toBe('file');
  });

  it('attaches an error reply to the request still in flight', () => {
    const state = beginOpenDoc(emptyOpenDocs(), artifactDocId('Plan'), 'Plan');
    const error: PhoneViewerModel = { status: 'error', title: 'Plan', message: 'missing' };
    expect(docIdForViewer(error, state.requestedId)).toBe(artifactDocId('Plan'));
    expect(docIdForViewer(file('a.ts'), null)).toBe(fileDocId('a.ts'));
  });
});
