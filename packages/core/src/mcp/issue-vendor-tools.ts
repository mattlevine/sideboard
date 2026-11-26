import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import {
  cursorIssuesUnavailableReason,
  listGitHubIssues,
} from '../integrations/issues.js';
import { listLinearIssuesFiltered } from '../integrations/linear.js';
import {
  isAbleTimeConnected,
  isLinearConnected,
  loadAppSettings,
  type AppSettings,
} from '../store/app-settings.js';
import type { IssueInfo } from '../types/thread.js';
import { registerAbleTimeTools } from './abletime-tools.js';
import { registerGithubIssueTools } from './github-tools.js';
import { registerLinearTools } from './linear-tools.js';

/**
 * One assigned ticket from the same Account lists as `linear_search_issues`
 * and `github_search_issues` (`assignee=me`). AbleTime is not included.
 */
export interface AssignedTicket {
  source: 'linear' | 'github';
  identifier: string;
  title: string;
  url: string;
  /** Linear project name and team key, used to pick a registered repo. */
  projects: string[];
  /** Set for GitHub, the checkout the issue was listed from. */
  repoPath?: string;
}

export interface AssignedTicketList {
  tickets: AssignedTicket[];
  /**
   * Key prefixes to keep from the previous latch. A failed Linear or GitHub
   * read must not look like those tickets were unassigned.
   */
  failedPrefixes: string[];
}

function ticketProjects(issue: IssueInfo): string[] {
  const names = (issue.projects ?? [])
    .map((project) => project.name?.trim() || '')
    .filter(Boolean);
  if (issue.teamKey?.trim()) names.push(issue.teamKey.trim());
  return names;
}

function toAssignedTicket(issue: IssueInfo, repoPath?: string): AssignedTicket | null {
  const identifier = issue.identifier?.trim();
  if (!identifier) return null;
  const source = issue.provider === 'github' ? 'github' : 'linear';
  return {
    source,
    identifier,
    title: issue.title?.trim() || identifier,
    url: issue.url?.trim() || '',
    projects: ticketProjects(issue),
    ...(repoPath ? { repoPath } : {}),
  };
}

/**
 * Open issues assigned to the signed-in Linear user and to `@me` on each
 * registered GitHub repo. `null` means every source that was tried failed —
 * the caller keeps its previous latch. Cursor and Entire origins are skipped
 * (they have no GitHub Issues). Linear is omitted when Account Linear is off,
 * and its previous keys are kept.
 */
export async function listTicketsAssignedToMe(
  repoPaths: string[],
): Promise<AssignedTicketList | null> {
  const settings = loadAppSettings();
  const tickets: AssignedTicket[] = [];
  const failedPrefixes: string[] = [];
  const seen = new Set<string>();
  let attempted = 0;
  let succeeded = 0;

  const push = (ticket: AssignedTicket | null) => {
    if (!ticket) return;
    const key = `${ticket.source}:${ticket.repoPath ?? ''}:${ticket.identifier.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    tickets.push(ticket);
  };

  if (!isLinearConnected(settings)) {
    failedPrefixes.push('linear:');
  } else {
    attempted += 1;
    try {
      const listed = await listLinearIssuesFiltered({ assignee: 'me', limit: 50 });
      succeeded += 1;
      for (const issue of listed.issues) push(toAssignedTicket(issue));
    } catch {
      failedPrefixes.push('linear:');
    }
  }

  const repos = [...new Set(repoPaths.map((path) => path.trim()).filter(Boolean))];
  for (const repoPath of repos) {
    let blocked = false;
    try {
      blocked = Boolean(await cursorIssuesUnavailableReason(repoPath));
    } catch {
      blocked = false;
    }
    if (blocked) {
      succeeded += 1;
      continue;
    }
    attempted += 1;
    try {
      const issues = await listGitHubIssues(repoPath, { assignee: 'me', limit: 50, strict: true });
      succeeded += 1;
      for (const issue of issues) push(toAssignedTicket({ ...issue, provider: 'github' }, repoPath));
    } catch {
      failedPrefixes.push(`github:${normalizeWorktreePath(repoPath)}:`);
    }
  }

  if (attempted > 0 && succeeded === 0) return null;
  return { tickets, failedPrefixes };
}

/**
 * Register issue-tracker MCP tools for the connected Account sources.
 * GitHub Issues (via `gh`) is always available. Linear / AbleTime only when
 * that Settings → Issues connection exists. `list_issues` stays separate.
 */
export function registerConnectedIssueVendorTools(
  server: McpServer,
  settings: AppSettings = loadAppSettings(),
): void {
  registerGithubIssueTools(server);
  if (isLinearConnected(settings)) registerLinearTools(server);
  if (isAbleTimeConnected(settings)) registerAbleTimeTools(server);
}
