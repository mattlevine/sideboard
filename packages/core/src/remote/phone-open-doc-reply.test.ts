import { describe, expect, it } from 'vitest';
import { parseFilePathLink } from '../../../../apps/mobile/file-link.ts';
import {
  beginOpenDoc,
  closeOpenDoc,
  emptyOpenDocs,
  fileDocId,
  placeOpenReply,
  sameOpenFile,
  selectOpenDoc,
  writeOpenDoc,
} from '../../../../apps/mobile/phone-open-doc-state.ts';

function file(path: string) {
  return { status: 'file', title: path, path, content: 'body', encoding: 'utf8' };
}

describe('sameOpenFile', () => {
  it('treats dot-slash, hash, file URLs, and absolute worktree paths as the Mac relative path', () => {
    expect(sameOpenFile('./apps/mobile/App.tsx', 'apps/mobile/App.tsx')).toBe(true);
    expect(sameOpenFile('apps/mobile/App.tsx#L12-L40', 'apps/mobile/App.tsx')).toBe(true);
    expect(sameOpenFile('file:///tmp/sideboard-wt/a%20b.png', 'a b.png')).toBe(true);
    expect(sameOpenFile('/tmp/sideboard-wt/apps/mobile/App.tsx', 'apps/mobile/App.tsx')).toBe(true);
  });

  it('does not treat a longer relative path as a shorter one', () => {
    expect(sameOpenFile('other/apps/foo.ts', 'apps/foo.ts')).toBe(false);
    expect(sameOpenFile('b.ts', 'a.ts')).toBe(false);
  });
});

describe('placeOpenReply', () => {
  it('renames an in-flight tab onto the Mac relative path and shows the file', () => {
    const state = beginOpenDoc(emptyOpenDocs(), fileDocId('./apps/mobile/App.tsx'), './apps/mobile/App.tsx');
    const placed = placeOpenReply(state, file('apps/mobile/App.tsx'));
    expect(placed?.replacedId).toBe(fileDocId('./apps/mobile/App.tsx'));
    expect(placed?.id).toBe(fileDocId('apps/mobile/App.tsx'));
    expect(placed?.state.docs.map((doc) => doc.id)).toEqual([fileDocId('apps/mobile/App.tsx')]);
    expect(placed?.state.docs[0]?.viewer.status).toBe('file');
    expect(placed?.state.requestedId).toBeNull();
    expect(placed?.state.activeId).toBe(fileDocId('apps/mobile/App.tsx'));
  });

  it('keeps a reply for an absolute path on that tab', () => {
    const raw = '/tmp/sideboard-wt/apps/mobile/App.tsx';
    const state = beginOpenDoc(emptyOpenDocs(), fileDocId(raw), raw);
    const placed = placeOpenReply(state, file('apps/mobile/App.tsx'));
    expect(placed?.state.activeId).toBe(fileDocId('apps/mobile/App.tsx'));
    expect(placed?.state.docs[0]?.viewer).toMatchObject({ status: 'file', path: 'apps/mobile/App.tsx' });
  });

  it('does not steal a different in-flight file', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('./a.ts'), './a.ts');
    state = beginOpenDoc(state, fileDocId('b.ts'), 'b.ts');
    const placed = placeOpenReply(state, file('a.ts'));
    expect(placed?.state.activeId).toBe(fileDocId('b.ts'));
    expect(placed?.state.requestedId).toBe(fileDocId('b.ts'));
    expect(placed?.state.docs.map((doc) => doc.id)).toEqual([fileDocId('a.ts'), fileDocId('b.ts')]);
    expect(placed?.state.docs[0]?.viewer.status).toBe('file');
    expect(placed?.state.docs[1]?.viewer.status).toBe('loading');
  });

  it('drops a reply for a file the user already closed', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('./a.ts'), './a.ts');
    state = closeOpenDoc(state, fileDocId('./a.ts'));
    expect(placeOpenReply(state, file('a.ts'))).toBeNull();
  });

  it('fills a normalized file without leaving the tab the user switched to', () => {
    let state = beginOpenDoc(emptyOpenDocs(), fileDocId('a.ts'), 'a.ts');
    state = writeOpenDoc(state, fileDocId('a.ts'), file('a.ts'), true);
    state = beginOpenDoc(state, fileDocId('./b.ts'), './b.ts');
    state = selectOpenDoc(state, fileDocId('a.ts'));
    const placed = placeOpenReply(state, file('b.ts'));
    expect(placed?.state.activeId).toBe(fileDocId('a.ts'));
    expect(placed?.state.docs[1]).toMatchObject({ id: fileDocId('b.ts'), viewer: { status: 'file' } });
  });
});

describe('parseFilePathLink', () => {
  it('stores the path the Mac will echo, without a dot-slash or hash', () => {
    expect(parseFilePathLink('./apps/mobile/App.tsx#L4')).toEqual({
      path: 'apps/mobile/App.tsx',
      startLine: 4,
    });
    expect(parseFilePathLink('./shot.png')).toEqual({ path: 'shot.png' });
    expect(parseFilePathLink('12:15:./apps/mobile/App.tsx')).toEqual({
      path: 'apps/mobile/App.tsx',
      startLine: 12,
      endLine: 15,
    });
  });
});
