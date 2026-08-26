import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listIssues, listPrs } = vi.hoisted(() => ({
  listIssues: vi.fn(),
  listPrs: vi.fn(),
}));

vi.mock('../integrations/issues.js', () => ({ listIssues }));
vi.mock('../git/worktree.js', () => ({ listPrs }));

import { loadHomeBoardInputs } from './load-home-board.js';

describe('loadHomeBoardInputs', () => {
  beforeEach(() => {
    listIssues.mockReset();
    listPrs.mockReset();
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
