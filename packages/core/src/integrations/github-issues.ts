import { ghRepoSelectArgs, resolveGithubRepoSlug, resolveRepoRoot } from '../git/worktree.js';
import { gh } from '../git/run.js';
import type { IssueInfo } from '../types/thread.js';

export interface GitHubIssueComment {
  id?: string;
  body: string;
  url?: string;
  createdAt?: string;
  author?: string;
}

export interface GitHubIssue {
  id: string;
  identifier: string;
  number: number;
  title: string;
  url: string;
  body?: string;
  state?: string;
  labels: string[];
  assignees: string[];
  comments: GitHubIssueComment[];
}

function requireGhOk(
  result: { stdout: string; stderr: string; exitCode: number },
  label: string,
): string {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'gh failed';
    throw new Error(`${label}: ${detail}`);
  }
  return result.stdout;
}

export function parseGitHubIssueNumber(id: string): number {
  const trimmed = id.trim();
  if (!trimmed) throw new Error('GitHub issue id is required (#123 or a URL)');
  const url = trimmed.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/i);
  if (url) return Number(url[1]);
  const prefixed = trimmed.match(/^gh-(\d+)$/i);
  if (prefixed) return Number(prefixed[1]);
  const bare = trimmed.match(/^#?(\d+)$/);
  if (bare) return Number(bare[1]);
  throw new Error(`GitHub issue id must be #123, a number, or an issue URL (got ${trimmed})`);
}

export async function resolveGitHubIssueRepo(
  repoPath?: string | null,
): Promise<{ cwd: string; slug: string | null; repoArgs: string[] }> {
  const cwd = await resolveRepoRoot((repoPath ?? '').trim() || process.cwd());
  const slug = await resolveGithubRepoSlug(cwd);
  return { cwd, slug, repoArgs: slug ? ghRepoSelectArgs(slug) : [] };
}

function mapLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item : String((item as { name?: string })?.name ?? '')))
    .map((name) => name.trim())
    .filter(Boolean);
}

function mapAssignees(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) =>
      typeof item === 'string' ? item : String((item as { login?: string })?.login ?? ''),
    )
    .map((login) => login.trim())
    .filter(Boolean);
}

function mapComments(raw: unknown): GitHubIssueComment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      if (!rec) return null;
      const body = typeof rec.body === 'string' ? rec.body : '';
      const authorRec =
        rec.author && typeof rec.author === 'object'
          ? (rec.author as { login?: string })
          : null;
      const comment: GitHubIssueComment = {
        body,
        id: rec.id != null ? String(rec.id) : undefined,
        url: typeof rec.url === 'string' ? rec.url : undefined,
        createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : undefined,
        author: authorRec?.login?.trim() || undefined,
      };
      return comment;
    })
    .filter((item): item is GitHubIssueComment => Boolean(item));
}

function toGitHubIssue(raw: Record<string, unknown>): GitHubIssue {
  const number = Number(raw.number);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('GitHub issue response was missing a number');
  }
  const assignees = mapAssignees(raw.assignees);
  return {
    id: `gh-${number}`,
    identifier: `#${number}`,
    number,
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    body: typeof raw.body === 'string' && raw.body.trim() ? raw.body : undefined,
    state: typeof raw.state === 'string' ? raw.state : undefined,
    labels: mapLabels(raw.labels),
    assignees,
    comments: mapComments(raw.comments),
  };
}

export function toGitHubIssueInfo(issue: GitHubIssue): IssueInfo {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    labels: issue.labels,
    provider: 'github',
    assignee: issue.assignees[0],
    assignees: issue.assignees.length ? issue.assignees : undefined,
  };
}

export async function getGitHubIssue(
  id: string,
  opts?: { repoPath?: string | null },
): Promise<GitHubIssue> {
  const number = parseGitHubIssueNumber(id);
  const { cwd, repoArgs } = await resolveGitHubIssueRepo(opts?.repoPath);
  const stdout = requireGhOk(
    await gh(
      [
        'issue',
        'view',
        String(number),
        ...repoArgs,
        '--json',
        'number,title,body,url,state,labels,assignees,comments,author',
      ],
      cwd,
      { reject: false },
    ),
    `GitHub issue ${number}`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`GitHub issue ${number}: gh returned non-JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`GitHub issue not found: #${number}`);
  }
  return toGitHubIssue(parsed as Record<string, unknown>);
}

export async function commentGitHubIssue(
  input: { id: string; body: string },
  opts?: { repoPath?: string | null },
): Promise<{ id?: string; url?: string; body: string }> {
  const number = parseGitHubIssueNumber(input.id);
  const body = input.body.trim();
  if (!body) throw new Error('GitHub comment body is required');
  const { cwd, repoArgs } = await resolveGitHubIssueRepo(opts?.repoPath);
  const stdout = requireGhOk(
    await gh(
      ['issue', 'comment', String(number), ...repoArgs, '--body', body],
      cwd,
      { reject: false },
    ),
    `GitHub comment on #${number}`,
  );
  const url = stdout.trim().split(/\s+/).find((part) => /^https?:\/\//i.test(part));
  return { body, url };
}

export async function updateGitHubIssue(
  input: { id: string; title?: string; body?: string; state?: string },
  opts?: { repoPath?: string | null },
): Promise<GitHubIssue> {
  const number = parseGitHubIssueNumber(input.id);
  const title = input.title?.trim();
  const body = input.body;
  const state = input.state?.trim().toLowerCase();
  if (!title && body === undefined && !state) {
    throw new Error('github_update_issue needs at least one of title, body, state');
  }
  const { cwd, repoArgs } = await resolveGitHubIssueRepo(opts?.repoPath);
  if (state === 'closed' || state === 'close') {
    requireGhOk(
      await gh(['issue', 'close', String(number), ...repoArgs], cwd, { reject: false }),
      `GitHub close #${number}`,
    );
  } else if (state === 'open' || state === 'reopen') {
    requireGhOk(
      await gh(['issue', 'reopen', String(number), ...repoArgs], cwd, { reject: false }),
      `GitHub reopen #${number}`,
    );
  } else if (state) {
    throw new Error(`GitHub issue state must be open or closed (got ${input.state})`);
  }
  if (title || body !== undefined) {
    const args = ['issue', 'edit', String(number), ...repoArgs];
    if (title) args.push('--title', title);
    if (body !== undefined) args.push('--body', body);
    requireGhOk(await gh(args, cwd, { reject: false }), `GitHub edit #${number}`);
  }
  return getGitHubIssue(String(number), opts);
}

export async function createGitHubIssue(
  input: { title: string; body?: string; parent?: string },
  opts?: { repoPath?: string | null },
): Promise<GitHubIssue> {
  const title = input.title.trim();
  if (!title) throw new Error('GitHub issue title is required');
  const parent = input.parent?.trim();
  const parentNumber = parent ? parseGitHubIssueNumber(parent) : null;
  const bodyParts = [
    parentNumber ? `Spin-off of #${parentNumber}.` : null,
    input.body?.trim() || null,
  ].filter(Boolean);
  const { cwd, repoArgs } = await resolveGitHubIssueRepo(opts?.repoPath);
  const args = ['issue', 'create', ...repoArgs, '--title', title];
  if (bodyParts.length) args.push('--body', bodyParts.join('\n\n'));
  const created = await gh([...args, '--json', 'number,url,title'], cwd, { reject: false });
  if (created.exitCode === 0 && created.stdout.trim()) {
    try {
      const parsed = JSON.parse(created.stdout) as { number?: number };
      if (parsed.number) return getGitHubIssue(String(parsed.number), opts);
    } catch {
      /* fall through to URL parse */
    }
  }
  const fallback = created.exitCode === 0 ? created : await gh(args, cwd, { reject: false });
  const stdout = requireGhOk(fallback, 'GitHub create issue');
  const url = stdout.trim().match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/i);
  if (url?.[1]) return getGitHubIssue(url[1], opts);
  throw new Error(`GitHub create issue: could not parse issue from ${stdout.trim() || 'empty output'}`);
}
