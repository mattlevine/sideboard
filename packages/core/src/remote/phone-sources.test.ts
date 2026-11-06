import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrInfo } from '../types/thread.js';

const { listPrs, getPr, listBranches, listIssues } = vi.hoisted(() => ({
  listPrs: vi.fn(),
  getPr: vi.fn(),
  listBranches: vi.fn(),
  listIssues: vi.fn(),
}));

vi.mock('../git/worktree.js', () => ({ listPrs, getPr, listBranches }));
vi.mock('../integrations/issues.js', () => ({ listIssues }));
vi.mock('./phone-chats.js', () => ({
  assertKnownProject: (repoPath: string) => repoPath,
  clip: (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`),
}));

import { listPhoneSources, phonePrMatchesQuery, phonePrNumberQuery } from './phone-sources.js';

function pr(number: number, title: string, state = 'OPEN'): PrInfo {
  return {
    number,
    title,
    headRefName: `branch-${number}`,
    url: `https://example.com/${number}`,
    isCrossRepository: false,
    state,
  };
}

describe('phone PR picker query', () => {
  it('reads a PR number with or without a hash', () => {
    expect(phonePrNumberQuery('  #482 ')).toBe(482);
    expect(phonePrNumberQuery('482')).toBe(482);
    expect(phonePrNumberQuery('0')).toBeNull();
    expect(phonePrNumberQuery('login')).toBeNull();
    expect(phonePrNumberQuery('#')).toBeNull();
  });

  it('matches the title or the PR number', () => {
    const row = { number: 1482, title: 'Fix the login flow' };
    expect(phonePrMatchesQuery(row, 'login')).toBe(true);
    expect(phonePrMatchesQuery(row, 'LOGIN')).toBe(true);
    expect(phonePrMatchesQuery(row, '482')).toBe(true);
    expect(phonePrMatchesQuery(row, '#1482')).toBe(true);
    expect(phonePrMatchesQuery(row, 'billing')).toBe(false);
    expect(phonePrMatchesQuery(row, '')).toBe(true);
  });
});

describe('listPhoneSources pull requests', () => {
  beforeEach(() => {
    listPrs.mockReset();
    getPr.mockReset();
    listBranches.mockReset();
    listIssues.mockReset();
    listBranches.mockResolvedValue([]);
    listIssues.mockResolvedValue({ issues: [] });
    getPr.mockResolvedValue(null);
  });

  it('lists open PRs when the query is empty', async () => {
    listPrs.mockResolvedValue([pr(1, 'One'), pr(2, 'Two')]);
    const page = await listPhoneSources('/repo');
    expect(page.prs.map((row) => row.ref)).toEqual(['1', '2']);
    expect(listPrs).toHaveBeenCalledTimes(1);
    expect(listPrs).toHaveBeenCalledWith('/repo', { state: 'open', limit: 40 });
    expect(getPr).not.toHaveBeenCalled();
  });

  it('keeps title matches and drops search hits that only mention the name', async () => {
    listPrs.mockImplementation(async (_path: string, opts?: { query?: string }) => {
      if (opts?.query) return [pr(3, 'Login flow'), pr(4, 'Session notes')];
      return [pr(5, 'Recent login fix'), pr(6, 'Unrelated'), pr(3, 'Login flow')];
    });
    const page = await listPhoneSources('/repo', 'login');
    expect(page.prs.map((row) => row.ref)).toEqual(['3', '5']);
    expect(getPr).not.toHaveBeenCalled();
    expect(listPrs).toHaveBeenCalledWith('/repo', { state: 'open', limit: 40, query: 'login' });
    expect(listPrs).toHaveBeenCalledWith('/repo', { state: 'open', limit: 40 });
  });

  it('finds a PR by number even when it is not in the recent list', async () => {
    getPr.mockResolvedValue(pr(12, 'Older pull'));
    listPrs.mockImplementation(async (_path: string, opts?: { query?: string }) => {
      if (opts?.query) return [pr(8, '12-factor app'), pr(50, 'Notes about twelve')];
      return [pr(123, 'Newer'), pr(99, 'Skip me'), pr(12, 'Older pull')];
    });
    const page = await listPhoneSources('/repo', '#12');
    expect(page.prs.map((row) => ({ ref: row.ref, title: row.title }))).toEqual([
      { ref: '12', title: 'Older pull' },
      { ref: '8', title: '12-factor app' },
      { ref: '123', title: 'Newer' },
    ]);
    expect(getPr).toHaveBeenCalledWith('/repo', 12);
    expect(listPrs).toHaveBeenCalledWith('/repo', { state: 'open', limit: 40, query: '12' });
    expect(listPrs).toHaveBeenCalledWith('/repo', { state: 'open', limit: 200 });
  });

  it('skips a closed PR looked up by number', async () => {
    getPr.mockResolvedValue(pr(12, 'Merged', 'MERGED'));
    listPrs.mockResolvedValue([pr(123, 'Still open')]);
    const page = await listPhoneSources('/repo', '12');
    expect(page.prs.map((row) => row.ref)).toEqual(['123']);
  });

  it('still lists number matches when the direct lookup fails', async () => {
    getPr.mockRejectedValue(new Error('gh down'));
    listPrs.mockResolvedValue([pr(12, 'Here'), pr(4, 'Nope')]);
    const page = await listPhoneSources('/repo', '12');
    expect(page.prs.map((row) => row.ref)).toEqual(['12']);
    expect(page.warnings).toBeUndefined();
  });

  it('reports a pull-request listing failure', async () => {
    listPrs.mockRejectedValue(new Error('gh down'));
    const page = await listPhoneSources('/repo', 'login');
    expect(page.prs).toEqual([]);
    expect(page.warnings).toEqual(['Pull requests: gh down']);
  });
});
