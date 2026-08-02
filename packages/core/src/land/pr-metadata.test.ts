import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../git/run.js', () => ({
  git: vi.fn(),
}));

import { git } from '../git/run.js';
import { suggestPrMetadata } from './pr-metadata.js';

const gitMock = vi.mocked(git);

function stubGit(map: Record<string, string>) {
  gitMock.mockImplementation(async (args) => {
    const key = args.join(' ');
    for (const [pattern, stdout] of Object.entries(map)) {
      if (key.includes(pattern)) {
        return { stdout, stderr: '', exitCode: 0 };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });
}

describe('suggestPrMetadata', () => {
  beforeEach(() => {
    gitMock.mockReset();
  });

  it('uses the first meaningful commit subject as the PR title', async () => {
    stubGit({
      'log --format=%s': 'fix: restore panel width persistence\nchore: wip',
      'diff --name-only main...HEAD': 'apps/desktop/src/App.tsx\n',
      'diff --stat main...HEAD': ' App.tsx | 2 +\n',
      'diff --name-only HEAD': '',
      'ls-files --others': '',
    });

    const meta = await suggestPrMetadata('/tmp/wt', {
      base: 'main',
      fallbackTitle: 'Paris FC',
      sourceLabel: 'local:main',
    });

    expect(meta.title).toBe('fix: restore panel width persistence');
    expect(meta.commitMessage).toBe('fix: restore panel width persistence');
    expect(meta.body).toContain('fix: restore panel width persistence');
    expect(meta.body).toContain('Landed via Sideboard from local:main');
  });

  it('ignores thread nicknames and falls back to changed paths', async () => {
    stubGit({
      'log --format=%s': 'sideboard: thread/paris\n',
      'diff --name-only main...HEAD': 'packages/core/src/land/land.ts\n',
      'diff --stat main...HEAD': '',
      'diff --name-only HEAD': '',
      'ls-files --others': '',
    });

    const meta = await suggestPrMetadata('/tmp/wt', {
      base: 'main',
      fallbackTitle: 'Arsenal',
    });

    expect(meta.title).toBe('Update packages/core/src/land/land.ts');
  });
});
