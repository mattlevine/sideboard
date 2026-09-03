import { describe, expect, it } from 'vitest';
import { buildFileTree, filesUnderPrefix } from './FileTree';

describe('filesUnderPrefix', () => {
  const paths = ['apps/desktop/src/App.tsx', 'apps/desktop/package.json', 'packages/core/src/index.ts'];

  it('lists files in a folder', () => {
    expect(filesUnderPrefix(paths, 'apps/desktop')).toEqual([
      'apps/desktop/src/App.tsx',
      'apps/desktop/package.json',
    ]);
  });

  it('accepts a trailing slash', () => {
    expect(filesUnderPrefix(paths, 'apps/desktop/')).toEqual([
      'apps/desktop/src/App.tsx',
      'apps/desktop/package.json',
    ]);
  });
});

describe('buildFileTree', () => {
  it('builds folders and files', () => {
    const tree = buildFileTree(['apps/desktop/src/App.tsx']);
    expect(tree[0]?.kind).toBe('dir');
    expect(tree[0]?.name).toBe('apps');
  });
});
