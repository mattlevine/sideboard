import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commentGitHubIssue,
  createGitHubIssue,
  getGitHubIssue,
  listGitHubIssueCommentsSince,
  parseGitHubIssueNumber,
  updateGitHubIssue,
} from './github-issues.js';

vi.mock('../git/worktree.js', () => ({
  resolveRepoRoot: async (cwd: string) => cwd || '/tmp/repo',
  resolveGithubRepoSlug: async () => 'acme/app',
  ghRepoSelectArgs: (slug: string) => ['-R', slug],
}));

const gh = vi.fn();
vi.mock('../git/run.js', () => ({
  gh: (...args: unknown[]) => gh(...args),
}));

afterEach(() => {
  gh.mockReset();
});

describe('parseGitHubIssueNumber', () => {
  it('accepts #123, gh-123, and URLs', () => {
    expect(parseGitHubIssueNumber('#12')).toBe(12);
    expect(parseGitHubIssueNumber('gh-12')).toBe(12);
    expect(parseGitHubIssueNumber('https://github.com/acme/app/issues/12')).toBe(12);
  });
});

describe('github issue writes', () => {
  it('views an issue with comments', async () => {
    gh.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        number: 12,
        title: 'Fix login',
        url: 'https://github.com/acme/app/issues/12',
        state: 'OPEN',
        body: 'Steps',
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'octocat' }],
        comments: [{ id: '1', body: 'Looks good', author: { login: 'ada' } }],
      }),
      stderr: '',
    });
    const issue = await getGitHubIssue('#12', { repoPath: '/tmp/repo' });
    expect(issue.identifier).toBe('#12');
    expect(issue.comments[0]?.body).toBe('Looks good');
    expect(gh.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(['issue', 'view', '12', '-R', 'acme/app']),
    );
  });

  it('comments, closes, and creates a spin-off', async () => {
    gh.mockImplementation(async (args: string[]) => {
      if (args[1] === 'comment') {
        return { exitCode: 0, stdout: 'https://github.com/acme/app/issues/12#issuecomment-1', stderr: '' };
      }
      if (args[1] === 'close') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args[1] === 'create') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            number: 13,
            title: 'Follow-up',
            url: 'https://github.com/acme/app/issues/13',
          }),
          stderr: '',
        };
      }
      if (args[1] === 'view') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            number: args[2] === '13' ? 13 : 12,
            title: args[2] === '13' ? 'Follow-up' : 'Fix login',
            url: `https://github.com/acme/app/issues/${args[2]}`,
            state: args[2] === '12' ? 'CLOSED' : 'OPEN',
            labels: [],
            assignees: [],
            comments: [],
          }),
          stderr: '',
        };
      }
      return { exitCode: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
    });

    const comment = await commentGitHubIssue(
      { id: '12', body: 'Done' },
      { repoPath: '/tmp/repo' },
    );
    expect(comment.url).toContain('issuecomment');

    const closed = await updateGitHubIssue(
      { id: '#12', state: 'closed' },
      { repoPath: '/tmp/repo' },
    );
    expect(closed.state).toBe('CLOSED');

    const spin = await createGitHubIssue(
      { title: 'Follow-up', parent: '#12' },
      { repoPath: '/tmp/repo' },
    );
    expect(spin.identifier).toBe('#13');
    const createArgs = gh.mock.calls.find((call) => call[0]?.[1] === 'create')?.[0] as string[];
    expect(createArgs.join(' ')).toMatch(/Spin-off of #12/);
  });
});

describe('listGitHubIssueCommentsSince', () => {
  it('keeps comments on the requested issue numbers', async () => {
    gh.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          body: 'On mine',
          created_at: '2026-09-10T12:00:00.000Z',
          issue_url: 'https://api.github.com/repos/acme/app/issues/12',
          user: { login: 'ada' },
        },
        {
          body: 'On theirs',
          created_at: '2026-09-10T12:00:00.000Z',
          issue_url: 'https://api.github.com/repos/acme/app/issues/99',
          user: { login: 'ada' },
        },
      ]),
      stderr: '',
    });
    const comments = await listGitHubIssueCommentsSince({
      since: '2026-09-10T00:00:00.000Z',
      repoPath: '/tmp/repo',
      issueIdentifiers: ['#12'],
    });
    expect(comments).toEqual([
      {
        identifier: '#12',
        author: 'ada',
        createdAt: '2026-09-10T12:00:00.000Z',
        body: 'On mine',
      },
    ]);
    const path = String(gh.mock.calls[0]?.[0]?.[1] ?? '');
    expect(path).toContain('repos/acme/app/issues/comments?since=');
    expect(path).toContain('direction=desc');
    expect(path).toContain('per_page=100');
    expect(path).toContain('page=1');
  });

  it('returns no comments when the inbox issue allowlist is empty', async () => {
    const comments = await listGitHubIssueCommentsSince({
      since: '2026-09-10T00:00:00.000Z',
      repoPath: '/tmp/repo',
      issueIdentifiers: [],
    });
    expect(comments).toEqual([]);
    expect(gh).not.toHaveBeenCalled();
  });

  it('pages newest-first until it finds comments on the inbox issues', async () => {
    gh.mockImplementation(async (args: string[]) => {
      const path = String(args[1] ?? '');
      const page = path.includes('page=2') ? 2 : 1;
      const noise = {
        body: 'Noise',
        created_at: '2026-09-11T12:00:00.000Z',
        issue_url: 'https://api.github.com/repos/acme/app/issues/99',
        user: { login: 'ada' },
      };
      return {
        exitCode: 0,
        stdout: JSON.stringify(
          page === 1
            ? Array.from({ length: 100 }, () => noise)
            : [
                {
                  body: 'On mine',
                  created_at: '2026-09-10T12:00:00.000Z',
                  issue_url: 'https://api.github.com/repos/acme/app/issues/12',
                  user: { login: 'ada' },
                },
              ],
        ),
        stderr: '',
      };
    });
    const comments = await listGitHubIssueCommentsSince({
      since: '2026-09-10T00:00:00.000Z',
      repoPath: '/tmp/repo',
      issueIdentifiers: ['#12'],
      limit: 1,
    });
    expect(comments).toEqual([
      {
        identifier: '#12',
        author: 'ada',
        createdAt: '2026-09-10T12:00:00.000Z',
        body: 'On mine',
      },
    ]);
    expect(gh).toHaveBeenCalledTimes(2);
    expect(String(gh.mock.calls[0]?.[0]?.[1] ?? '')).toContain('per_page=100');
    expect(String(gh.mock.calls[1]?.[0]?.[1] ?? '')).toContain('page=2');
  });
});
