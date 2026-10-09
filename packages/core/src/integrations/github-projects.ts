import { gh } from '../git/run.js';
import { resolveGithubRepoSlug, resolveRepoRoot } from '../git/worktree.js';

export interface GitHubProjectRef {
  id?: string;
  name: string;
}

export interface GitHubProject {
  id?: string;
  number?: number;
  title: string;
  url?: string;
  closed?: boolean;
  owner?: string;
}

export function rewriteGitHubProjectReadError(detail: string): string {
  const text = detail.trim() || 'gh could not read GitHub Projects';
  if (/read:project|project scope|missing required scopes/i.test(text)) {
    return `${text} — run \`gh auth refresh -s read:project\` so Sideboard can read GitHub Projects.`;
  }
  return text;
}

function githubProjectsUnreadable(result: { stderr: string; stdout: string }): boolean {
  return /project|scope|unknown json field/i.test(`${result.stderr}\n${result.stdout}`);
}

/** Project titles/ids from `gh issue view --json projectItems` (or a list row). */
export function githubProjectsOnIssue(raw: Record<string, unknown>): GitHubProjectRef[] {
  const out: GitHubProjectRef[] = [];
  const seen = new Set<string>();
  const fromItems = raw.projectItems ?? raw.projects ?? raw.projectItemsV2;
  if (!Array.isArray(fromItems)) return out;
  for (const item of fromItems) {
    if (typeof item === 'string') {
      const name = item.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const nested =
      rec.project && typeof rec.project === 'object'
        ? (rec.project as Record<string, unknown>)
        : rec;
    const id = String(nested.id ?? rec.id ?? '').trim();
    const name = String(nested.title ?? nested.name ?? rec.title ?? rec.name ?? '').trim();
    const label = name || id;
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...(id ? { id } : {}), name: label });
  }
  return out;
}

export async function readGitHubIssueProjects(
  number: number,
  cwd: string,
  repoArgs: string[],
): Promise<{ projects: GitHubProjectRef[]; error?: string }> {
  const result = await gh(
    ['issue', 'view', String(number), ...repoArgs, '--json', 'projectItems'],
    cwd,
    { reject: false },
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    const detail = (result.stderr || result.stdout).trim();
    if (detail && githubProjectsUnreadable(result)) {
      return { projects: [], error: rewriteGitHubProjectReadError(detail) };
    }
    return { projects: [] };
  }
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    return { projects: githubProjectsOnIssue(parsed) };
  } catch {
    return { projects: [] };
  }
}

export async function listGitHubIssueProjectNames(
  number: number,
  cwd: string,
  repoArgs: string[],
): Promise<string[]> {
  const read = await readGitHubIssueProjects(number, cwd, repoArgs);
  return read.projects.map((project) => project.name).filter(Boolean);
}

function parseGitHubProjectList(stdout: string): GitHubProject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { projects?: unknown }).projects)
      ? ((parsed as { projects: unknown[] }).projects ?? [])
      : [];
  const out: GitHubProject[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const title = String(rec.title ?? rec.name ?? '').trim();
    if (!title) continue;
    const ownerRec =
      rec.owner && typeof rec.owner === 'object' ? (rec.owner as { login?: string }) : null;
    const owner =
      ownerRec?.login?.trim() || (typeof rec.owner === 'string' ? rec.owner.trim() : '');
    const number = Number(rec.number);
    out.push({
      ...(typeof rec.id === 'string' && rec.id.trim() ? { id: rec.id.trim() } : {}),
      ...(Number.isFinite(number) ? { number } : {}),
      title,
      ...(typeof rec.url === 'string' && rec.url.trim() ? { url: rec.url.trim() } : {}),
      ...(typeof rec.closed === 'boolean' ? { closed: rec.closed } : {}),
      ...(owner ? { owner } : {}),
    });
  }
  return out;
}

/**
 * Open GitHub Projects for the signed-in user and, when known, the repo owner.
 * Titles are what `github_update_issue` `project` accepts.
 */
export async function listGitHubProjects(opts?: {
  repoPath?: string | null;
}): Promise<GitHubProject[]> {
  const cwd = await resolveRepoRoot((opts?.repoPath ?? '').trim() || process.cwd());
  const slug = await resolveGithubRepoSlug(cwd);
  const owners = new Set<string>(['']);
  const repoOwner = slug?.split('/')[0]?.trim();
  if (repoOwner) owners.add(repoOwner);
  const out: GitHubProject[] = [];
  const seen = new Set<string>();
  let lastError = '';
  let anyOk = false;
  for (const owner of owners) {
    const args = ['project', 'list', '--limit', '100', '--format', 'json'];
    if (owner) args.push('--owner', owner);
    const result = await gh(args, cwd, { reject: false });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      lastError = (result.stderr || result.stdout).trim() || lastError;
      continue;
    }
    anyOk = true;
    for (const project of parseGitHubProjectList(result.stdout)) {
      const key = (
        project.id || `${project.owner ?? ''}:${project.number ?? ''}:${project.title}`
      ).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(project);
    }
  }
  if (!anyOk) {
    throw new Error(rewriteGitHubProjectReadError(lastError || 'gh project list failed'));
  }
  return out;
}
