import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWorktreePathLink } from './reveal-worktree-path';

describe('openWorktreePathLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes citation line ranges to onOpenFile', async () => {
    const onOpenFile = vi.fn();
    vi.stubGlobal('window', {
      sideboard: {
        statPath: vi.fn(async () => 'file'),
      },
    });
    await openWorktreePathLink({
      link: { path: 'apps/desktop/src/App.tsx', startLine: 12, endLine: 15 },
      threadId: 't1',
      worktreePath: '/tmp/wt',
      onOpenFile,
    });
    expect(onOpenFile).toHaveBeenCalledWith('apps/desktop/src/App.tsx', {
      startLine: 12,
      endLine: 15,
    });
  });

  it('opens a file without a range when the link has none', async () => {
    const onOpenFile = vi.fn();
    vi.stubGlobal('window', {
      sideboard: {
        statPath: vi.fn(async () => 'file'),
      },
    });
    await openWorktreePathLink({
      link: { path: 'README.md' },
      threadId: 't1',
      worktreePath: '/tmp/wt',
      onOpenFile,
    });
    expect(onOpenFile).toHaveBeenCalledWith('README.md', undefined);
  });
});
