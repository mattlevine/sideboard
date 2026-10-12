import { describe, expect, it } from 'vitest';
import {
  findRightPaneByRef,
  parseArtifactLink,
  parseSideboardFileLink,
} from './chat-open-link';
import type { RightPaneContent } from './right-pane';

describe('parseArtifactLink', () => {
  it('reads an artifact id or title', () => {
    expect(parseArtifactLink('sideboard://artifact/dashboard')).toBe('dashboard');
    expect(parseArtifactLink('sideboard://artifact/My%20Dashboard/')).toBe('My Dashboard');
    expect(parseArtifactLink('sideboard://artifact/tool-log#ignored')).toBe('tool-log');
  });

  it('rejects other sideboard urls', () => {
    expect(parseArtifactLink('sideboard://chat/abc')).toBeNull();
    expect(parseArtifactLink('sideboard://file/apps/a.ts')).toBeNull();
    expect(parseArtifactLink('https://example.com')).toBeNull();
  });
});

describe('parseSideboardFileLink', () => {
  it('reads a repo path and a GitHub line range', () => {
    expect(parseSideboardFileLink('sideboard://file/apps/desktop/src/App.tsx')).toEqual({
      path: 'apps/desktop/src/App.tsx',
    });
    expect(
      parseSideboardFileLink('sideboard://file/apps/desktop/src/App.tsx#L12-L40'),
    ).toEqual({
      path: 'apps/desktop/src/App.tsx',
      startLine: 12,
      endLine: 40,
    });
    expect(parseSideboardFileLink('sideboard://file/./apps/a.ts#L3')).toEqual({
      path: 'apps/a.ts',
      startLine: 3,
    });
  });

  it('rejects escapes and absolute paths', () => {
    expect(parseSideboardFileLink('sideboard://file/../etc/passwd')).toBeNull();
    expect(parseSideboardFileLink('sideboard://file//etc/passwd')).toBeNull();
    expect(parseSideboardFileLink('sideboard://chat/abc')).toBeNull();
  });
});

describe('findRightPaneByRef', () => {
  const dash: RightPaneContent = {
    id: 'tool-dashboard',
    title: 'Dashboard',
    kind: 'html',
    language: 'html',
    content: '<p>new</p>',
    source: 'tool',
  };
  const older: RightPaneContent = {
    id: 'msg-0-0',
    title: 'Dashboard',
    kind: 'html',
    language: 'html',
    content: '<p>old</p>',
    source: 'fence',
  };
  const schema: RightPaneContent = {
    kind: 'schema',
    id: 'schema-posts',
    title: 'Posts',
    mode: 'table',
    datasource: 'inline',
    resourceId: 'posts',
    source: 'tool',
  };
  const files: RightPaneContent = {
    kind: 'files',
    id: 'files-media',
    title: 'Media',
    datasource: 'memory',
    path: 'uploads',
    source: 'tool',
  };

  it('prefers an id match and otherwise the newest title', () => {
    const panes = [older, dash, schema, files];
    expect(findRightPaneByRef(panes, 'dashboard')).toBe(dash);
    expect(findRightPaneByRef(panes, 'Dashboard')).toBe(dash);
    expect(findRightPaneByRef(panes, 'msg-0-0')).toBe(older);
    expect(findRightPaneByRef(panes, 'posts')).toBe(schema);
    expect(findRightPaneByRef(panes, 'uploads')).toBe(files);
    expect(findRightPaneByRef(panes, 'missing')).toBeNull();
  });
});
