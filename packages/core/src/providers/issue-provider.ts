import {
  getAbleTimeOrientation,
  listAbleTimeTasks,
  searchAbleTimeTasks,
  toAbleTimeIssueInfo,
  type AbleTimeTask,
} from '../integrations/abletime.js';
import { issueMatchesAssignee } from '../integrations/issue-assignee.js';
import type { ListIssuesOptions } from '../integrations/issue-list-types.js';
import { listGitHubIssueCommentsSince } from '../integrations/github-issues.js';
import {
  issueMatchesUpdatedSince,
  parseIssueSince,
  previewIssueCommentBody,
} from '../integrations/issue-since.js';
import { listLinearCommentsSince, listLinearIssuesFiltered } from '../integrations/linear.js';
import type { IssueSource } from '../store/app-settings.js';
import type { IssueActivityComment, IssueInfo } from '../types/thread.js';
import { githubViewerLogin } from './github-issue-list.js';
import { githubHostForRepo } from './resolve-git-host.js';
import type { IssuePage, IssueProvider } from './types.js';

function takeIssuePage(issues: IssueInfo[], limit?: number): IssueInfo[] {
  if (limit == null) return issues;
  const n = Math.max(1, Math.min(1000, Math.floor(limit)));
  return issues.slice(0, n);
}

function commentsFromAbleTimeIssues(
  tasks: Array<Pick<AbleTimeTask, 'identifier' | 'title' | 'comments'>>,
  issues: IssueInfo[],
  sinceIso: string,
): IssueActivityComment[] {
  const keep = new Set(issues.map((issue) => issue.identifier));
  const sinceMs = Date.parse(sinceIso);
  const out: IssueActivityComment[] = [];
  for (const task of tasks) {
    if (!keep.has(task.identifier)) continue;
    for (const comment of task.comments) {
      const at = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
      if (Number.isFinite(at) && Number.isFinite(sinceMs) && at < sinceMs) continue;
      out.push({
        identifier: task.identifier,
        title: task.title,
        ...(comment.user ? { author: comment.user } : {}),
        ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
        body: previewIssueCommentBody(comment.body),
        ...(comment.url ? { url: comment.url } : {}),
      });
    }
  }
  return out;
}

const githubIssueProvider: IssueProvider = {
  id: 'github',
  label: 'GitHub',
  listIssues(repoPath, opts) {
    return this.listIssuePage(repoPath, opts).then((page) => page.issues);
  },
  async listIssuePage(repoPath, opts) {
    const host = await githubHostForRepo(repoPath);
    const since = opts?.updatedSince ? parseIssueSince(opts.updatedSince) : undefined;
    const [issues, login] = await Promise.all([
      host.listIssues(repoPath, {
        assignee: opts?.assignee,
        query: opts?.query,
        limit: opts?.limit,
        updatedSince: since,
      }),
      githubViewerLogin(repoPath),
    ]);
    const comments = since
      ? await listGitHubIssueCommentsSince({
          since,
          repoPath,
          issueIdentifiers: issues.map((issue) => issue.identifier),
          limit: opts?.limit,
        })
      : undefined;
    return {
      issues,
      viewer: login ? { login } : undefined,
      ...(since ? { since, comments: comments ?? [] } : {}),
    };
  },
};

const linearIssueProvider: IssueProvider = {
  id: 'linear',
  label: 'Linear',
  listIssues(repoPath, opts) {
    return this.listIssuePage(repoPath, opts).then((page) => page.issues);
  },
  async listIssuePage(_repoPath, opts) {
    const since = opts?.updatedSince ? parseIssueSince(opts.updatedSince) : undefined;
    const listed = await listLinearIssuesFiltered({
      assignee: opts?.assignee,
      query: opts?.query,
      limit: opts?.limit,
      updatedSince: since,
    });
    const comments = since
      ? await listLinearCommentsSince({
          since,
          assignee: opts?.assignee,
          query: opts?.query,
          issueIdentifiers: opts?.query
            ? listed.issues.map((issue) => issue.identifier)
            : undefined,
          limit: opts?.limit,
        })
      : undefined;
    return {
      issues: listed.issues,
      viewer: { login: listed.viewer.name, name: listed.viewer.name },
      ...(since ? { since, comments: comments ?? [] } : {}),
    };
  },
};

const abletimeIssueProvider: IssueProvider = {
  id: 'abletime',
  label: 'AbleTime',
  listIssues(repoPath, opts) {
    return this.listIssuePage(repoPath, opts).then((page) => page.issues);
  },
  async listIssuePage(_repoPath, opts) {
    const query = opts?.query?.trim() || undefined;
    const since = opts?.updatedSince ? parseIssueSince(opts.updatedSince) : undefined;
    const [tasks, orientation] = await Promise.all([
      query ? searchAbleTimeTasks(query) : listAbleTimeTasks(),
      getAbleTimeOrientation().catch(() => null),
    ]);
    const viewerName = orientation?.viewer.name ?? orientation?.viewer.id ?? '';
    const mapped = tasks
      .map(toAbleTimeIssueInfo)
      .filter((issue) => issueMatchesAssignee(issue, opts?.assignee, viewerName))
      .filter((issue) => !since || issueMatchesUpdatedSince(issue, since));
    const issues = takeIssuePage(mapped, opts?.limit);
    return {
      issues,
      viewer: {
        login: orientation?.viewer.name,
        name: orientation?.viewer.name,
      },
      ...(since
        ? { since, comments: commentsFromAbleTimeIssues(tasks, issues, since) }
        : {}),
    };
  },
};

const ISSUE_PROVIDERS: Record<IssueSource, IssueProvider> = {
  github: githubIssueProvider,
  linear: linearIssueProvider,
  abletime: abletimeIssueProvider,
};

export function issueProvider(source: IssueSource): IssueProvider {
  return ISSUE_PROVIDERS[source] ?? githubIssueProvider;
}

export function listIssuesFromProvider(
  source: IssueSource,
  repoPath: string,
  opts?: ListIssuesOptions,
): Promise<IssuePage> {
  return issueProvider(source).listIssuePage(repoPath, opts);
}
