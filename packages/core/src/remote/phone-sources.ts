import { listBranches, listPrs } from '../git/worktree.js';
import { listIssues } from '../integrations/issues.js';
import { assertKnownProject, clip, type PhoneSources } from './phone-chats.js';

function sourceWarning(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message ? `${label}: ${message}` : `${label} failed.`;
}

/** PRs, branches, and issues for the create-worktree picker. */
export async function listPhoneSources(repoPath: string, query?: string): Promise<PhoneSources> {
  const path = assertKnownProject(repoPath);
  const q = query?.trim() ?? '';
  const warnings: string[] = [];
  const [prs, branches, issues] = await Promise.all([
    listPrs(path, { state: 'open', limit: 40, ...(q ? { query: q } : {}) }).catch((err: unknown) => {
      warnings.push(sourceWarning('Pull requests', err));
      return [];
    }),
    listBranches(path).catch((err: unknown) => {
      warnings.push(sourceWarning('Branches', err));
      return [];
    }),
    listIssues(path, { limit: 40, ...(q ? { query: q } : {}) }).catch((err: unknown) => {
      warnings.push(sourceWarning('Issues', err));
      return { issues: [] };
    }),
  ]);
  const needle = q.toLowerCase();
  const branchRows = branches
    .filter((branch) => !needle || branch.name.toLowerCase().includes(needle))
    .slice(0, 50)
    .map((branch) => ({
      ref: branch.name,
      title: branch.current ? `${branch.name} (current)` : branch.name,
    }));
  return {
    prs: prs.slice(0, 40).map((pr) => ({
      ref: String(pr.number),
      title: clip(pr.title || `PR #${pr.number}`, 140),
      ...(pr.url ? { url: pr.url } : {}),
    })),
    branches: branchRows,
    issues: (issues.issues ?? []).slice(0, 40).map((issue) => ({
      ref: issue.identifier,
      title: clip(issue.title || issue.identifier, 140),
      ...(issue.url ? { url: issue.url } : {}),
    })),
    ...(warnings.length ? { warnings } : {}),
  };
}
