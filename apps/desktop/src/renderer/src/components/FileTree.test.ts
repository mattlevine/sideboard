import { describe, expect, it } from 'vitest';
import {
  ancestorDirectories,
  buildFileTree,
  expandedWithFocus,
  filesUnderPrefix,
} from './FileTree';

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

  it('injects extra directories that have no tracked files', () => {
    const tree = buildFileTree(
      ['apps/desktop/src/App.tsx'],
      ['.context/.sideboard/detached-jobs/typecheck-workspaces-skill'],
    );
    const context = tree.find((n) => n.name === '.context');
    expect(context?.kind).toBe('dir');
    const job = context?.children
      ?.find((n) => n.name === '.sideboard')
      ?.children?.find((n) => n.name === 'detached-jobs')
      ?.children?.find((n) => n.name === 'typecheck-workspaces-skill');
    expect(job?.kind).toBe('dir');
  });
});

describe('ancestorDirectories', () => {
  it('includes the path and each parent', () => {
    expect(ancestorDirectories('apps/desktop/src')).toEqual([
      'apps',
      'apps/desktop',
      'apps/desktop/src',
    ]);
  });
});

describe('expandedWithFocus', () => {
  it('opens every ancestor of the focused folder', () => {
    const next = expandedWithFocus(['apps'], '.context/.sideboard/detached-jobs');
    expect([...next]).toEqual(
      expect.arrayContaining([
        'apps',
        '.context',
        '.context/.sideboard',
        '.context/.sideboard/detached-jobs',
      ]),
    );
  });

  it('leaves the worktree root alone', () => {
    expect([...expandedWithFocus(['apps'], '.')]).toEqual(['apps']);
  });
});
