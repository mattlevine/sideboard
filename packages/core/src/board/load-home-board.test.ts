import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listIssues, listPrs } = vi.hoisted(() => ({
  listIssues: vi.fn(),
  listPrs: vi.fn(),
}));

vi.mock('../integrations/issues.js', () => ({ listIssues }));
vi.mock('../git/worktree.js', () => ({ listPrs }));

import {
  clearHomeBoardCache,
  getHomeBoardInputs,
  loadHomeBoardInputs,
  resetHomeBoardMemory,
  shouldCacheHomeBoardInputs,
} from './load-home-board.js';
import { HOME_BOARD_CACHE_TTL_MS } from './home-board.js';

describe('loadHomeBoardInputs', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-home-board-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    clearHomeBoardCache();
    listIssues.mockReset();
    listPrs.mockReset();
  });

  afterEach(() => {
    clearHomeBoardCache();
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists Linear issues once and PRs per workspace', async () => {
    listIssues.mockResolvedValue({
      source: 'linear',
      preferredSource: 'linear',
      linearConnected: true,
      issues: [
        {
          id: '1',
          identifier: 'ENG-1',
          title: 'Login',
          url: 'https://linear.app/eng-1',
          labels: [],
          provider: 'linear',
        },
      ],
    });
    listPrs
      .mockResolvedValueOnce([{ number: 1, title: 'A', headRefName: 'a', url: 'https://gh/a/1' }])
      .mockResolvedValueOnce([{ number: 2, title: 'B', headRefName: 'b', url: 'https://gh/b/2' }]);

    const result = await loadHomeBoardInputs([
      { path: '/a', name: 'a' },
      { path: '/b', name: 'b' },
    ]);

    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(listPrs).toHaveBeenCalledTimes(2);
    expect(result.issueSource).toBe('linear');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.needsWorkspacePick).toBe(true);
    expect(result.prs.map((p) => p.number)).toEqual([2, 1]);
    expect(result.issueErrors).toEqual([]);
    expect(result.prErrors).toEqual([]);
  });

  it('lists GitHub issues per workspace and keeps partial PR failures', async () => {
    listIssues.mockImplementation(async (path: string) => ({
      source: 'github',
      preferredSource: 'github',
      linearConnected: false,
      issues: [
        {
          id: `gh-${path}`,
          identifier: '#1',
          title: path,
          url: `https://gh${path}/1`,
          labels: [],
          provider: 'github',
        },
      ],
    }));
    listPrs.mockImplementation(async (path: string) => {
      if (path === '/b') throw new Error('gh down');
      return [{ number: 9, title: 'Ok', headRefName: 'ok', url: 'https://gh/a/9' }];
    });

    const result = await loadHomeBoardInputs([{ path: '/a' }, { path: '/b' }]);
    expect(listIssues).toHaveBeenCalledTimes(2);
    expect(result.issues).toHaveLength(2);
    expect(result.prs).toHaveLength(1);
    expect(result.prErrors.some((e) => e.includes('gh down'))).toBe(true);
  });
});

describe('getHomeBoardInputs cache', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-home-board-cache-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    clearHomeBoardCache();
    listIssues.mockReset();
    listPrs.mockReset();
    listIssues.mockResolvedValue({
      source: 'linear',
      preferredSource: 'linear',
      linearConnected: true,
      issues: [
        {
          id: '1',
          identifier: 'ENG-1',
          title: 'Login',
          url: 'https://linear.app/eng-1',
          labels: [],
          provider: 'linear',
        },
      ],
    });
    listPrs.mockResolvedValue([
      { number: 1, title: 'A', headRefName: 'a', url: 'https://gh/a/1' },
    ]);
  });

  afterEach(() => {
    clearHomeBoardCache();
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reuses a fresh snapshot instead of calling Linear/GitHub again', async () => {
    const first = await getHomeBoardInputs([{ path: '/a' }]);
    expect(first.fromCache).toBe(false);
    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(listPrs).toHaveBeenCalledTimes(1);

    const second = await getHomeBoardInputs([{ path: '/a' }]);
    expect(second.fromCache).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.issues[0]?.identifier).toBe('ENG-1');
    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(listPrs).toHaveBeenCalledTimes(1);
  });

  it('reloads a fresh disk snapshot after memory is cleared', async () => {
    await getHomeBoardInputs([{ path: '/a' }]);
    listIssues.mockClear();
    listPrs.mockClear();
    resetHomeBoardMemory();

    const fromDisk = await getHomeBoardInputs([{ path: '/a' }]);
    expect(fromDisk.fromCache).toBe(true);
    expect(fromDisk.issues[0]?.identifier).toBe('ENG-1');
    expect(listIssues).not.toHaveBeenCalled();
  });

  it('refresh=true pulls remote APIs again', async () => {
    await getHomeBoardInputs([{ path: '/a' }]);
    listIssues.mockClear();
    listPrs.mockClear();

    const refreshed = await getHomeBoardInputs([{ path: '/a' }], { refresh: true });
    expect(refreshed.fromCache).toBe(false);
    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(listPrs).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL expires', async () => {
    const first = await getHomeBoardInputs([{ path: '/a' }], { now: 1_000 });
    expect(first.fromCache).toBe(false);
    listIssues.mockClear();
    listPrs.mockClear();

    const stale = await getHomeBoardInputs([{ path: '/a' }], {
      now: 1_000 + HOME_BOARD_CACHE_TTL_MS + 1,
    });
    expect(stale.fromCache).toBe(false);
    expect(listIssues).toHaveBeenCalledTimes(1);
  });

  it('does not cache a total remote failure', () => {
    expect(
      shouldCacheHomeBoardInputs({
        issues: [],
        prs: [],
        issueSource: 'linear',
        issueErrors: ['Linear down'],
        prErrors: ['gh down'],
      }),
    ).toBe(false);
    expect(
      shouldCacheHomeBoardInputs({
        issues: [
          {
            id: '1',
            identifier: 'ENG-1',
            title: 'Login',
            url: 'https://linear.app/eng-1',
            labels: [],
            provider: 'linear',
            repoPath: '/a',
            needsWorkspacePick: false,
          },
        ],
        prs: [],
        issueSource: 'linear',
        issueErrors: [],
        prErrors: ['gh down'],
      }),
    ).toBe(true);
  });
});
