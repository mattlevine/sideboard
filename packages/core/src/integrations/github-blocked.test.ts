import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGitHubIssueBlockedBy, githubBlockedByIdentifiers } from './github-blocked.js';

vi.mock('../git/worktree.js', () => ({
  resolveRepoRoot: async (cwd: string) => cwd || '/tmp/repo',
  resolveGithubRepoSlug: async () => 'acme/app',
  ghRepoSelectArgs: (slug: string) => ['-R', slug],
}));

const gh = vi.fn();
vi.mock('../git/run.js', () => ({
  gh: (...args: unknown[]) => gh(...args),
  resolveGhAuthToken: async () => 'ghs_test',
}));

afterEach(() => {
  gh.mockReset();
});

describe('githubBlockedByIdentifiers', () => {
  it('reads issue numbers from the GraphQL payload', () => {
    expect(
      githubBlockedByIdentifiers({
        data: {
          repository: {
            issue: { blockedBy: { nodes: [{ number: 8 }, { number: 8 }, { number: 4 }] } },
          },
        },
      }),
    ).toEqual(['#8', '#4']);
  });
});

describe('getGitHubIssueBlockedBy', () => {
  it('queries blockedBy through gh api graphql', async () => {
    gh.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        data: { repository: { issue: { blockedBy: { nodes: [{ number: 3 }] } } } },
      }),
      stderr: '',
    });
    await expect(getGitHubIssueBlockedBy('#12', { repoPath: '/tmp/repo' })).resolves.toEqual([
      '#3',
    ]);
    const args = gh.mock.calls[0]?.[0] as string[];
    expect(args.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(args.join(' ')).toContain('blockedBy');
  });
});
