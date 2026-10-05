/**
 * GitHub issue file attachments (user-attachments / githubusercontent).
 * Kept out of github-issues.ts for the max-lines ratchet.
 */
import { resolveRepoRoot } from '../git/worktree.js';
import { resolveGhAuthToken } from '../git/run.js';
import {
  downloadAuthenticatedFile,
  extractHttpUrls,
  hostMatches,
  issueAttachmentWorktreePath,
  mergeIssueAttachments,
  type DownloadedIssueAttachment,
  type IssueVendorAttachment,
} from './issue-attachments.js';
import type { GitHubIssue } from './github-issues.js';

const GITHUB_FILE_HOSTS = ['github.com', 'githubusercontent.com'] as const;

export function isGitHubIssueAttachmentUrl(url: string): boolean {
  if (!hostMatches(url, GITHUB_FILE_HOSTS)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (host === 'github.com' || host.endsWith('.github.com')) {
      return path.startsWith('/user-attachments/');
    }
    return true;
  } catch {
    return false;
  }
}

export function extractGitHubIssueAttachments(
  issue: Pick<GitHubIssue, 'body' | 'comments'>,
): IssueVendorAttachment[] {
  const texts = [issue.body ?? '', ...issue.comments.map((comment) => comment.body)];
  return mergeIssueAttachments(
    texts.flatMap((text) =>
      extractHttpUrls(text)
        .filter(isGitHubIssueAttachmentUrl)
        .map((url) => ({
          id: url,
          name: url.split('/').pop() || 'attachment',
          url,
        })),
    ),
  );
}

/**
 * Download a GitHub issue file (user-attachments / githubusercontent) using
 * Account `gh` into `.context/attachments/`. Pass the URL from
 * `github_get_issue` attachments.
 */
export async function downloadGitHubIssueAttachment(
  input: { url: string; name?: string },
  opts?: { repoPath?: string | null },
): Promise<DownloadedIssueAttachment> {
  const url = input.url.trim();
  if (!url) throw new Error('GitHub attachment URL is required');
  if (!isGitHubIssueAttachmentUrl(url)) {
    throw new Error(
      `GitHub attachment URL must be github.com/user-attachments/… or githubusercontent.com (got ${url})`,
    );
  }
  const cwd = await resolveRepoRoot((opts?.repoPath ?? '').trim() || process.cwd());
  const token = await resolveGhAuthToken(cwd);
  return downloadAuthenticatedFile({
    url,
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
          Accept: 'application/octet-stream',
        }
      : { Accept: 'application/octet-stream' },
    worktreePath: issueAttachmentWorktreePath(opts?.repoPath ?? cwd),
    name: input.name,
  });
}
