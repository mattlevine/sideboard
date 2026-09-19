import { describe, expect, it } from 'vitest';
import {
  isKnownDirectoryPath,
  parseFilePathLink,
  toWorktreeRelativePath,
} from './file-path-link';

const WT = '/Users/me/sideboard/workspaces/sideboard/sporting-jax';

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

  it('matches directory-like paths without an extension', () => {
    expect(
      parseFilePathLink('.context/.sideboard/detached-jobs/typecheck-workspaces-skill'),
    ).toEqual({
      path: '.context/.sideboard/detached-jobs/typecheck-workspaces-skill',
    });
  });

  it('strips a trailing slash on directory paths', () => {
    expect(parseFilePathLink('apps/desktop/')).toEqual({ path: 'apps/desktop' });
  });

  it('matches a single-segment known directory', () => {
    expect(parseFilePathLink('apps', ['apps/desktop/src/App.tsx'])).toEqual({
      path: 'apps',
    });
  });

  it('maps absolute worktree paths to relative paths', () => {
    expect(
      parseFilePathLink(
        `${WT}/.context/.sideboard/detached-jobs/typecheck-workspaces-skill`,
        undefined,
        WT,
      ),
    ).toEqual({
      path: '.context/.sideboard/detached-jobs/typecheck-workspaces-skill',
    });
  });

  it('ignores absolute paths outside the worktree', () => {
    expect(parseFilePathLink('/etc/passwd', undefined, WT)).toBeNull();
  });

  it('ignores non-path inline code', () => {
    expect(parseFilePathLink('npm install')).toBeNull();
  });
});

describe('toWorktreeRelativePath', () => {
  it('passes through relative paths', () => {
    expect(toWorktreeRelativePath('apps/desktop/src/App.tsx', WT)).toBe(
      'apps/desktop/src/App.tsx',
    );
  });

  it('rejects parent-directory escapes', () => {
    expect(toWorktreeRelativePath('../secret', WT)).toBeNull();
    expect(toWorktreeRelativePath(`${WT}/../secret`, WT)).toBeNull();
  });

  it('treats the worktree root as .', () => {
    expect(toWorktreeRelativePath(WT, WT)).toBe('.');
  });
});

describe('isKnownDirectoryPath', () => {
  it('is true when a tracked file lives under the path', () => {
    expect(isKnownDirectoryPath('apps/desktop', ['apps/desktop/src/App.tsx'])).toBe(
      true,
    );
  });

  it('is false for a file path', () => {
    expect(isKnownDirectoryPath('apps/desktop/src/App.tsx', ['apps/desktop/src/App.tsx'])).toBe(
      false,
    );
  });
});
