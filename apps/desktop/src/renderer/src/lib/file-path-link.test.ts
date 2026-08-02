import { describe, expect, it } from 'vitest';
import { parseFilePathLink } from './file-path-link';

describe('parseFilePathLink', () => {
  it('parses cursor-style citation labels', () => {
    expect(parseFilePathLink('12:15:apps/desktop/src/App.tsx')).toEqual({
      path: 'apps/desktop/src/App.tsx',
      startLine: 12,
      endLine: 15,
    });
  });

  it('matches known repo paths', () => {
    expect(parseFilePathLink('App.tsx', ['apps/desktop/src/App.tsx'])).toEqual({
      path: 'apps/desktop/src/App.tsx',
    });
  });

  it('matches path-like inline code', () => {
    expect(parseFilePathLink('apps/desktop/src/renderer/src/App.tsx')).toEqual({
      path: 'apps/desktop/src/renderer/src/App.tsx',
    });
  });

  it('ignores non-path inline code', () => {
    expect(parseFilePathLink('npm install')).toBeNull();
  });
});
