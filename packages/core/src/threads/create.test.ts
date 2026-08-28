import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  isAbleTimeConnected: () => false,
  getIssueSource: () => 'linear',
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

import { createEmptyThread, writeThread } from '../store/thread-store.js';
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

  it('copies create-modal image drops into .context/attachments', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const thread = await createThread({
      sourceType: 'branch',
      sourceRef: 'default',
      agent: 'claude',
      repoPath: repo,
      cowboy: true,
      attachments: [
        {
          id: 'shot',
          name: 'Screenshot.png',
          kind: 'file',
          previewDataUrl: `data:image/png;base64,${png.toString('base64')}`,
          content:
            'Image attached: Screenshot.png\nThe image is shown in the composer; copy it into the worktree if you need to inspect pixels.',
        },
      ],
    });
    expect(thread.attachments[0]?.path).toBe('.context/attachments/Screenshot.png');
    expect(
      existsSync(join(thread.worktreePath, '.context', 'attachments', 'Screenshot.png')),
    ).toBe(true);
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

describe('createThread reuses a live named branch', () => {
  let dataDir: string;
  let repo: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-reuse-data-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    createThreadWorktree.mockReset();
    createThreadWorktree.mockResolvedValue({
      branchName: 'thread/new',
      worktreePath: join(tmpdir(), 'sideboard-reuse-wt'),
    });
    repo = mkdtempSync(join(tmpdir(), 'sideboard-reuse-repo-'));
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

  it('returns the existing live thread for the same named branch', async () => {
    const existing = createEmptyThread({
      title: 'Already open',
      sourceType: 'branch',
      sourceRef: 'feat/login',
      branchName: 'thread/limon',
      worktreePath: join(repo, 'wt'),
      repoPath: repo,
      agent: 'claude',
    });
    writeThread(existing);
    const again = await createThread({
      sourceType: 'branch',
      sourceRef: 'feat/login',
      agent: 'claude',
      repoPath: repo,
    });
    expect(again.id).toBe(existing.id);
    expect(createThreadWorktree).not.toHaveBeenCalled();
  });

  it('still creates a new worktree from the default branch', async () => {
    const existing = createEmptyThread({
      title: 'From default',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/other',
      worktreePath: join(repo, 'wt'),
      repoPath: repo,
      agent: 'claude',
    });
    writeThread(existing);
    const next = await createThread({
      sourceType: 'branch',
      sourceRef: 'default',
      agent: 'claude',
      repoPath: repo,
    });
    expect(next.id).not.toBe(existing.id);
    expect(createThreadWorktree).toHaveBeenCalled();
  });

  it('does not reuse when reuseExisting is false', async () => {
    const existing = createEmptyThread({
      title: 'Source',
      sourceType: 'branch',
      sourceRef: 'feat/login',
      branchName: 'thread/limon',
      worktreePath: join(repo, 'wt'),
      repoPath: repo,
      agent: 'claude',
    });
    writeThread(existing);
    const next = await createThread({
      sourceType: 'branch',
      sourceRef: 'feat/login',
      agent: 'claude',
      repoPath: repo,
      reuseExisting: false,
    });
    expect(next.id).not.toBe(existing.id);
    expect(createThreadWorktree).toHaveBeenCalled();
  });
});
