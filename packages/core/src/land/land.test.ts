import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../types/thread.js';

vi.mock('../git/worktree.js', () => ({
  commitAll: vi.fn(async () => true),
  createOrUpdatePr: vi.fn(),
  currentBranch: vi.fn(async () => 'main'),
  isDirty: vi.fn(async () => true),
  pushBranch: vi.fn(async () => undefined),
  resolveDefaultBranch: vi.fn(async () => 'main'),
}));

vi.mock('../diff/diff.js', () => ({
  getDiff: vi.fn(async () => ({ stat: '1 file changed', dirty: true })),
}));

vi.mock('./pr-metadata.js', () => ({
  suggestPrMetadata: vi.fn(async () => ({
    title: 't',
    body: 'b',
    commitMessage: 'wip',
  })),
}));

import { commitAll, createOrUpdatePr, pushBranch } from '../git/worktree.js';
import { confirmLand, previewLand } from './land.js';

const cowboyThread = {
  id: 't1',
  title: 'Cowboy · main',
  sourceType: 'branch',
  sourceRef: 'main',
  branchName: 'main',
  worktreePath: '/tmp/repo',
  repoPath: '/tmp/repo',
  cowboy: true,
} as Thread;

describe('land cowboy', () => {
  it('does not block the default branch and skips the PR', async () => {
    const preview = await previewLand(cowboyThread);
    expect(preview.blocked).toBe(false);
    expect(preview.cowboy).toBe(true);

    const result = await confirmLand(cowboyThread);
    expect(result.prUrl).toBeNull();
    expect(result.pushed).toBe(true);
    expect(commitAll).toHaveBeenCalled();
    expect(pushBranch).toHaveBeenCalledWith('/tmp/repo', 'main');
    expect(createOrUpdatePr).not.toHaveBeenCalled();
  });
});
