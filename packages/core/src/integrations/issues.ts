import { listIssuesFromProvider } from '../providers/issue-provider.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  loadAppSettings,
  resolveEffectiveIssueSource,
  type IssueSource,
} from '../store/app-settings.js';
import type { IssueActivityComment, IssueInfo } from '../types/thread.js';
import { issueMatchesAssignee } from './issue-assignee.js';
import type { IssueAssigneeFilter, ListIssuesOptions } from './issue-list-types.js';

export type { IssueSource };
export type { IssueAssigneeFilter, ListIssuesOptions };
export { issueMatchesAssignee };
export { listGitHubIssues } from '../providers/github-issue-list.js';

export interface ListIssuesResult {
  source: IssueSource;
  /** Preference before fallback (useful for “Set up Linear / AbleTime” UI). */
  preferredSource: IssueSource;
  linearConnected: boolean;
  abletimeConnected: boolean;
  issues: IssueInfo[];
  /** Linear viewer name or GitHub login — used for “assigned to me”. */
  viewer?: { login?: string; name?: string };
  /** Parsed UTC ISO when `updatedSince` was passed. */
  since?: string;
  /** Comments created at/after `since` on the listed tickets. */
  comments?: IssueActivityComment[];
}

/**
 * Unified issue list for Create-from / Link issue / Home / MCP / CLI.
 * The active issue provider (Linear, AbleTime, or GitHub) fills the rows.
 */
export async function listIssues(
  repoPath: string,
  opts?: ListIssuesOptions,
): Promise<ListIssuesResult> {
  const settings = loadAppSettings();
  const preferredSource = settings.integrations.issueSource ?? 'github';
  const linearConnected = isLinearConnected(settings);
  const abletimeConnected = isAbleTimeConnected(settings);
  const source = resolveEffectiveIssueSource(settings);
  const page = await listIssuesFromProvider(source, repoPath, opts);
  return {
    source,
    preferredSource,
    linearConnected,
    abletimeConnected,
    issues: page.issues,
    viewer: page.viewer,
    ...(page.since ? { since: page.since, comments: page.comments ?? [] } : {}),
  };
}
