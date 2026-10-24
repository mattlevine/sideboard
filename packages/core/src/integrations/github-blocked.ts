import { gh } from '../git/run.js';
import { parseGitHubIssueNumber, resolveGitHubIssueRepo } from './github-issues.js';

/** Issue numbers that block this one. `gh issue view --json` does not expose the field. */
export function githubBlockedByIdentifiers(payload: unknown): string[] {
  const root =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const data =
    root?.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;
  const repository =
    data?.repository && typeof data.repository === 'object'
      ? (data.repository as Record<string, unknown>)
      : null;
  const issue =
    repository?.issue && typeof repository.issue === 'object'
      ? (repository.issue as Record<string, unknown>)
      : null;
  const blocked =
    issue?.blockedBy && typeof issue.blockedBy === 'object'
      ? (issue.blockedBy as Record<string, unknown>)
      : null;
  const nodes = Array.isArray(blocked?.nodes)
    ? blocked.nodes
    : Array.isArray(root?.blockedBy)
      ? root.blockedBy
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const rec =
      node && typeof node === 'object' && !Array.isArray(node)
        ? (node as Record<string, unknown>)
        : null;
    const number = Number(rec?.number ?? node);
    if (!Number.isFinite(number) || number <= 0) continue;
    const id = `#${number}`;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

const GITHUB_BLOCKED_BY_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 25) { nodes { number } }
    }
  }
}
`;

/** Blocking issue numbers for one GitHub issue (`#123` or a URL). */
export async function getGitHubIssueBlockedBy(
  id: string,
  opts?: { repoPath?: string | null },
): Promise<string[]> {
  const number = parseGitHubIssueNumber(id);
  const { cwd, slug } = await resolveGitHubIssueRepo(opts?.repoPath);
  const [owner, name] = (slug ?? '').split('/');
  if (!owner || !name) throw new Error('GitHub repo is not connected');
  const result = await gh(
    [
      'api',
      'graphql',
      '-f',
      `query=${GITHUB_BLOCKED_BY_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${number}`,
    ],
    cwd,
    { reject: false },
  );
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'gh failed';
    throw new Error(`GitHub issue #${number} blocked-by: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub issue #${number} blocked-by: gh returned non-JSON`);
  }
  const errors =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { errors?: unknown }).errors)
      ? (parsed as { errors: Array<{ message?: string }> }).errors
      : [];
  if (errors.length > 0) {
    throw new Error(
      `GitHub issue #${number} blocked-by: ${errors.map((e) => e.message ?? 'GitHub error').join('; ')}`,
    );
  }
  const issue = (parsed as { data?: { repository?: { issue?: unknown } } }).data?.repository
    ?.issue;
  if (!issue) throw new Error(`GitHub issue not found: #${number}`);
  return githubBlockedByIdentifiers(parsed);
}
