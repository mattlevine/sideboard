import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
}));

import { git } from './run.js';
import { resolveWorktreeStartPoint } from './worktree.js';

const gitMock = vi.mocked(git);

describe('resolveWorktreeStartPoint', () => {
  beforeEach(() => {
    gitMock.mockReset();
  });

  it('prefers origin/<branch> after fetch so forks track remote main', async () => {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'rev-parse --verify origin/main') {
        return { stdout: 'abc123', stderr: '', exitCode: 0 };
      }
      if (key === 'rev-parse --verify main') {
        return { stdout: 'oldlocal', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(resolveWorktreeStartPoint('/repo', 'main')).resolves.toBe(
      'origin/main',
    );
  });

  it('falls back to local ref when remote tip is missing', async () => {
    gitMock.mockImplementation(async (args) => {
      const key = args.join(' ');
      if (key === 'rev-parse --verify origin/sideboard-pr-9') {
        return { stdout: '', stderr: '', exitCode: 1 };
      }
      if (key === 'rev-parse --verify sideboard-pr-9') {
        return { stdout: 'prsha', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      resolveWorktreeStartPoint('/repo', 'sideboard-pr-9'),
    ).resolves.toBe('sideboard-pr-9');
  });

  it('keeps explicit origin/ refs', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args.join(' ') === 'rev-parse --verify origin/main') {
        return { stdout: 'abc', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    await expect(
      resolveWorktreeStartPoint('/repo', 'origin/main'),
    ).resolves.toBe('origin/main');
  });
});
