import {
  GLOBAL_WORKSPACE_ID,
  issueSourceLabel,
  type IssueInfo,
  type Thread,
  type Workspace,
} from '@sideboard-ai/core';

export type BoardColumnId =
  | 'backlog'
  | 'queued'
  | 'running'
  | 'needs_you'
  | 'review'
  | 'done';

export const BOARD_COLUMN_DEFS: { id: BoardColumnId; title: string }[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'queued', title: 'Queued' },
  { id: 'running', title: 'Running' },
  { id: 'needs_you', title: 'Needs you' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

/** Issue card on Home — `repoPath` is where Start will create the worktree. */
export type BoardIssue = IssueInfo & {
  repoPath: string;
  /** Linear / unknown + multiple workspaces: show a compact picker before Start. */
  needsWorkspacePick: boolean;
};

export { issueSourceLabel };

export function isOpenPrState(
  prUrl: string | null | undefined,
  prState: string | null | undefined,
): boolean {
  if (!prUrl?.trim()) return false;
  const state = (prState ?? 'OPEN').trim().toUpperCase();
  return state !== 'MERGED' && state !== 'CLOSED';
}

/**
 * Derived Home column. Agent/PR state is source of truth — no drag-to-status.
 * Priority: archived → queued → running → error → idle/stopped+lastError →
 * open PR → leftover live (human is next).
 */
export function classifyThreadColumn(
  thread: Pick<Thread, 'status' | 'lastError' | 'prUrl' | 'prState'>,
): BoardColumnId {
  if (thread.status === 'archived') return 'done';
  if (thread.status === 'queued') return 'queued';
  if (thread.status === 'running') return 'running';
  if (thread.status === 'error' || thread.status === 'broken') return 'needs_you';
  if (
    (thread.status === 'idle' || thread.status === 'stopped') &&
    Boolean(thread.lastError?.trim())
  ) {
    return 'needs_you';
  }
  if (isOpenPrState(thread.prUrl, thread.prState)) return 'review';
  return 'needs_you';
}

function normalizeIssueKey(value: string): string {
  return value.trim().toLowerCase().replace(/^#/, '');
}

/** Live thread for this ticket: `sourceType=ticket` + sourceRef, or title/identifier. */
export function threadMatchesIssue(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title'>,
  issue: Pick<IssueInfo, 'identifier' | 'title'>,
): boolean {
  const identRaw = issue.identifier.trim().toLowerCase();
  const identKey = normalizeIssueKey(issue.identifier);
  const title = issue.title.trim().toLowerCase();
  const refRaw = thread.sourceRef.trim().toLowerCase();
  const refKey = normalizeIssueKey(thread.sourceRef);
  const threadTitle = thread.title.trim().toLowerCase();

  if (thread.sourceType === 'ticket' && identKey && refKey === identKey) return true;
  if (identRaw && (refRaw === identRaw || threadTitle.includes(identRaw))) return true;
  if (title && threadTitle === title) return true;
  return false;
}

export function issueHasLiveThread(
  issue: Pick<IssueInfo, 'identifier' | 'title'>,
  threads: Pick<Thread, 'status' | 'sourceType' | 'sourceRef' | 'title'>[],
): boolean {
  return threads.some((t) => t.status !== 'archived' && threadMatchesIssue(t, issue));
}

export function backlogIssues(
  issues: BoardIssue[],
  threads: Pick<Thread, 'status' | 'sourceType' | 'sourceRef' | 'title'>[],
): BoardIssue[] {
  return issues.filter((issue) => !issueHasLiveThread(issue, threads));
}

export function dedupeBoardIssues(issues: BoardIssue[]): BoardIssue[] {
  const seen = new Set<string>();
  const out: BoardIssue[] = [];
  for (const issue of issues) {
    const key = [
      issue.repoPath,
      issue.provider ?? '',
      issue.id || issue.identifier,
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function pickDefaultRepoPath(
  workspaces: Pick<Workspace, 'path'>[],
  lastUsedRepoPath?: string | null,
): string {
  const paths = workspaces.map((w) => w.path).filter(Boolean);
  if (
    lastUsedRepoPath &&
    lastUsedRepoPath !== GLOBAL_WORKSPACE_ID &&
    paths.includes(lastUsedRepoPath)
  ) {
    return lastUsedRepoPath;
  }
  return paths[0] ?? '';
}

export function issueNeedsWorkspacePick(
  provider: IssueInfo['provider'] | undefined,
  workspaceCount: number,
): boolean {
  if (workspaceCount <= 1) return false;
  return provider !== 'github';
}

/** Stable card identity — GitHub numbers repeat across repos; Linear is account-wide. */
export function boardIssueKey(
  issue: Pick<BoardIssue, 'id' | 'identifier' | 'repoPath' | 'provider'>,
): string {
  const id = issue.id || issue.identifier;
  if (issue.provider === 'github') return `${issue.repoPath}::${id}`;
  return `account::${id}`;
}
