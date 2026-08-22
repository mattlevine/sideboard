import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

vi.mock('../detect/detect.js', () => ({
  requireAgent: vi.fn(async () => ({
    kind: 'claude',
    installed: true,
    authenticated: true,
  })),
}));

vi.mock('../store/app-settings.js', () => ({
  resolveNewThreadOptions: (opts: {
    agent?: string;
    model?: string | null;
    effort?: string;
    fast?: boolean;
  }) => ({
    agent: opts.agent ?? 'claude',
    model: opts.model ?? null,
    effort: opts.effort ?? 'high',
    fast: Boolean(opts.fast),
  }),
  cowboyModeEnabled: () => true,
}));

const { createThreadWorktree } = vi.hoisted(() => ({
  createThreadWorktree: vi.fn(),
}));

vi.mock('../git/worktree.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git/worktree.js')>();
  return {
    ...actual,
    createThreadWorktree,
  };
});

import { createThread } from './create.js';

describe('createThread cowboy', () => {
  let dataDir: string;
  let repo: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-cowboy-data-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    createThreadWorktree.mockReset();
    repo = mkdtempSync(join(tmpdir(), 'sideboard-cowboy-repo-'));
    await execa('git', ['init', '-b', 'main'], { cwd: repo });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), 'hi\n');
    await execa('git', ['add', 'README.md'], { cwd: repo });
    await execa('git', ['commit', '-m', 'init'], { cwd: repo });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('uses the project folder on main and does not add a worktree', async () => {
    const thread = await createThread({
      sourceType: 'branch',
      sourceRef: 'default',
      agent: 'claude',
      repoPath: repo,
      cowboy: true,
    });
    expect(thread.cowboy).toBe(true);
    expect(thread.worktreePath).toBe(thread.repoPath);
    expect(thread.branchName).toBe('main');
    expect(thread.worktreePath).toContain('sideboard-cowboy-repo-');
    expect(createThreadWorktree).not.toHaveBeenCalled();
  });

  it('refuses cowboy when the checkout is not the default branch', async () => {
    await execa('git', ['checkout', '-b', 'feat'], { cwd: repo });
    await expect(
      createThread({
        sourceType: 'branch',
        sourceRef: 'default',
        agent: 'claude',
        repoPath: repo,
        cowboy: true,
      }),
    ).rejects.toThrow(/Switch that checkout to main/);
    expect(createThreadWorktree).not.toHaveBeenCalled();
  });
});
