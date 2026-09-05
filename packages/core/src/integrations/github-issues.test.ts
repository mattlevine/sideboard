import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commentGitHubIssue,
  createGitHubIssue,
  getGitHubIssue,
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
