import { clip, assertKnownProject, type PhoneSources } from './phone-chats.js';
import { listWorkSources } from '../providers/work-sources.js';

/** PRs, branches, and issues for the create-worktree picker. */
export async function listPhoneSources(repoPath: string, query?: string): Promise<PhoneSources> {
  const path = assertKnownProject(repoPath);
  const listed = await listWorkSources(path, { query, limit: 40 });
  return {
    prs: listed.pullRequests.slice(0, 40).map((pr) => ({
      ref: String(pr.number),
      title: clip(pr.title || `PR #${pr.number}`, 140),
      ...(pr.url ? { url: pr.url } : {}),
    })),
    branches: listed.branches.slice(0, 50).map((branch) => ({
      ref: branch.name,
      title: branch.current ? `${branch.name} (current)` : branch.name,
    })),
    issues: listed.issues.issues.slice(0, 40).map((issue) => ({
      ref: issue.identifier,
      title: clip(issue.title || issue.identifier, 140),
      ...(issue.url ? { url: issue.url } : {}),
    })),
    ...(listed.warnings?.length ? { warnings: listed.warnings } : {}),
  };
}
