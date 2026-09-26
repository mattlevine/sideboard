import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PEER_NOTICE_PREFIX } from '../threads/injected-notices.js';
import { createEmptyThread, readThread, writeThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import {
  formatMainMovedNotice,
  formatPeerNoticeContinuePrompt,
  liveRepoSiblings,
  notifyRepoSiblingsOfMerge,
  overlapFiles,
  resetPeerMergeNotifications,
  shouldNotifyRepoSiblingsOfMerge,
} from './peer-notices.js';

describe('peer merge notices', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sideboard-peer-notice-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    resetPeerMergeNotifications();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('only fires when a PR first becomes MERGED', () => {
    expect(
      shouldNotifyRepoSiblingsOfMerge({
        previousPrState: 'OPEN',
        nextPrState: 'MERGED',
      }),
    ).toBe(true);
    expect(
      shouldNotifyRepoSiblingsOfMerge({
        previousPrState: 'MERGED',
        nextPrState: 'MERGED',
      }),
    ).toBe(false);
    expect(
      shouldNotifyRepoSiblingsOfMerge({
        previousPrState: 'OPEN',
        nextPrState: 'OPEN',
      }),
    ).toBe(false);
  });

  it('lists one live sibling per other worktree on the same repo', () => {
    const repo = join(dataDir, 'repo');
    const merged = createEmptyThread({
      title: 'Landed',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/landed',
      worktreePath: join(dataDir, 'wt-a'),
      repoPath: repo,
      agent: 'cursor',
    });
    const sibling = createEmptyThread({
      title: 'Other',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/other',
      worktreePath: join(dataDir, 'wt-b'),
      repoPath: repo,
      agent: 'claude',
    });
    sibling.createdAt = '2026-01-02T00:00:00.000Z';
    const tab = createEmptyThread({
      title: 'Other tab',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/other',
      worktreePath: join(dataDir, 'wt-b'),
      repoPath: repo,
      agent: 'claude',
    });
    tab.createdAt = '2026-01-03T00:00:00.000Z';
    const otherRepo = createEmptyThread({
      title: 'Elsewhere',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/x',
      worktreePath: join(dataDir, 'wt-c'),
      repoPath: join(dataDir, 'other-repo'),
      agent: 'cursor',
    });
    const orch = createEmptyThread({
      title: 'Global',
      sourceType: 'orchestration',
      sourceRef: 'Coordinate',
      branchName: 'global',
      worktreePath: join(dataDir, 'global'),
      repoPath: GLOBAL_WORKSPACE_ID,
      agent: 'claude',
    });
    const archived = createEmptyThread({
      title: 'Old',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/old',
      worktreePath: join(dataDir, 'wt-d'),
      repoPath: repo,
      agent: 'cursor',
    });
    archived.status = 'archived';
    const sameWt = createEmptyThread({
      title: 'Same checkout',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/landed',
      worktreePath: join(dataDir, 'wt-a'),
      repoPath: repo,
      agent: 'cursor',
    });
    const ids = liveRepoSiblings(merged, [
      merged,
      sibling,
      tab,
      otherRepo,
      orch,
      archived,
      sameWt,
    ]).map((t) => t.id);
    expect(ids).toEqual([sibling.id]);
  });

  it('intersects changed files with sibling dirty files', () => {
    expect(overlapFiles(['a.ts', 'b.ts'], ['b.ts', 'c.ts'])).toEqual(['b.ts']);
    expect(overlapFiles(['a.ts'], ['c.ts'])).toEqual([]);
  });

  it('formats an information-only notice with overlap', () => {
    const text = formatMainMovedNotice({
      fromTitle: 'Fix meter',
      fromThreadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fromBranch: 'thread/ajax',
      prUrl: 'https://github.com/acme/app/pull/12',
      changedFiles: ['packages/core/src/foo.ts'],
      overlapFiles: ['packages/core/src/foo.ts'],
    });
    expect(text.startsWith(PEER_NOTICE_PREFIX)).toBe(true);
    expect(text).toContain('not a user command');
    expect(text).toContain('sideboard://thread/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(text).toContain('packages/core/src/foo.ts');
    expect(text).toContain('Overlap');
    expect(text).not.toMatch(/^Merge PR\.$/m);
    expect(formatPeerNoticeContinuePrompt(1)).toContain('not a command');
    expect(formatPeerNoticeContinuePrompt(2)).toContain('2 fleet notices');
  });

  it('injects a notice and queues a continue without calling send twice', async () => {
    mkdirSync(join(dataDir, 'wt-a'), { recursive: true });
    mkdirSync(join(dataDir, 'wt-b'), { recursive: true });
    const repo = join(dataDir, 'repo');
    const merged = createEmptyThread({
      title: 'Landed',
      sourceType: 'pr',
      sourceRef: 'https://github.com/acme/app/pull/12',
      branchName: 'thread/landed',
      worktreePath: join(dataDir, 'wt-a'),
      repoPath: repo,
      agent: 'cursor',
    });
    merged.prUrl = 'https://github.com/acme/app/pull/12';
    writeThread(merged);
    const sibling = createEmptyThread({
      title: 'Other',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/other',
      worktreePath: join(dataDir, 'wt-b'),
      repoPath: repo,
      agent: 'claude',
    });
    writeThread(sibling);

    const sends: Array<{ id: string; prompt: string }> = [];
    const git = {
      listChangedFiles: async () => ['src/a.ts', 'src/b.ts'],
      listDirtyFiles: async () => ['src/b.ts', 'src/c.ts'],
    };
    const n = await notifyRepoSiblingsOfMerge({
      merged,
      previousPrState: 'OPEN',
      nextPrState: 'MERGED',
      send: async (id, prompt) => {
        sends.push({ id, prompt });
      },
      git,
    });
    expect(n).toBe(1);
    const again = await notifyRepoSiblingsOfMerge({
      merged,
      previousPrState: 'OPEN',
      nextPrState: 'MERGED',
      send: async (id, prompt) => {
        sends.push({ id, prompt });
      },
      git,
    });
    expect(again).toBe(0);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.id).toBe(sibling.id);
    expect(sends[0]!.prompt).toContain('not a command');
    const after = readThread(sibling.id)!;
    expect(after.messages[0]!.text).toContain(PEER_NOTICE_PREFIX);
    expect(after.messages[0]!.text).toContain('src/b.ts');
    expect(after.messages[0]!.role).toBe('agent');
  });

  it('does not notify when the PR is not newly merged', async () => {
    const merged = createEmptyThread({
      title: 'Landed',
      sourceType: 'branch',
      sourceRef: 'main',
      branchName: 'thread/landed',
      worktreePath: join(dataDir, 'wt-a'),
      repoPath: join(dataDir, 'repo'),
      agent: 'cursor',
    });
    writeThread(merged);
    const n = await notifyRepoSiblingsOfMerge({
      merged,
      previousPrState: 'MERGED',
      nextPrState: 'MERGED',
      send: async () => {
        throw new Error('should not send');
      },
    });
    expect(n).toBe(0);
  });
});
