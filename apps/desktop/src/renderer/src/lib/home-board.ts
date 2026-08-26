import { issueSourceLabel } from '@sideboard/issue-source-labels';
import type { IssueInfo, PrInfo, Thread, Workspace } from '@sideboard-ai/core';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';

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

/** Open PR with no live Sideboard thread — lands in Review. */
export type BoardPr = PrInfo & {
  repoPath: string;
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

export function boardPrKey(pr: Pick<BoardPr, 'number' | 'url' | 'repoPath'>): string {
  return pr.url?.trim() || `${pr.repoPath}::${pr.number}`;
}

function urlsMatch(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();
  return Boolean(a && b && norm(a) === norm(b));
}

/** Live thread for this PR: sourceType=pr + number, prUrl, or head branch. */
export function threadMatchesPr(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName'>,
  pr: Pick<PrInfo, 'number' | 'title' | 'url' | 'headRefName'>,
): boolean {
  const num = String(pr.number);
  if (thread.sourceType === 'pr' && normalizeIssueKey(thread.sourceRef) === num) {
    return true;
  }
  if (thread.prUrl && pr.url && urlsMatch(thread.prUrl, pr.url)) return true;
  const head = pr.headRefName.trim().toLowerCase();
  if (!head) return false;
  const branch = thread.branchName.trim().toLowerCase();
  const ref = thread.sourceRef
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '')
    .toLowerCase();
  if (branch === head) return true;
  if (!ref || /^(main|master|develop|development|trunk|default|head)$/.test(ref)) {
    return false;
  }
  return ref === head;
}

export function prHasLiveThread(
  pr: Pick<PrInfo, 'number' | 'title' | 'url' | 'headRefName'>,
  threads: Pick<Thread, 'status' | 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName'>[],
): boolean {
  return threads.some((t) => t.status !== 'archived' && threadMatchesPr(t, pr));
}

export function reviewPrs(
  prs: BoardPr[],
  threads: Pick<Thread, 'status' | 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName'>[],
): BoardPr[] {
  return prs.filter((pr) => !prHasLiveThread(pr, threads));
}

export function dedupeBoardPrs(prs: BoardPr[]): BoardPr[] {
  const seen = new Set<string>();
  const out: BoardPr[] = [];
  for (const pr of prs) {
    const key = boardPrKey(pr);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pr);
  }
  return out.sort((a, b) => b.number - a.number);
}

export const BOARD_PAGE_SIZE = 40;

export type BoardKindFilter = 'all' | 'tickets' | 'prs' | 'threads';

export function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function haystackMatches(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const h = haystack.toLowerCase();
  return tokens.every((token) => h.includes(token));
}

export function issueSearchText(
  issue: Pick<BoardIssue, 'identifier' | 'title' | 'labels' | 'provider' | 'repoPath'>,
  workspaceName = '',
): string {
  return [
    issue.identifier,
    issue.title,
    issue.labels.join(' '),
    issue.provider ?? '',
    workspaceName,
    issue.repoPath,
  ].join(' ');
}

export function prAuthorLogin(pr: Pick<PrInfo, 'author'>): string {
  return pr.author?.login?.trim() ?? '';
}

export function prSearchText(
  pr: Pick<BoardPr, 'number' | 'title' | 'headRefName' | 'url' | 'repoPath' | 'author'>,
  workspaceName = '',
  author = '',
): string {
  return [
    `#${pr.number}`,
    String(pr.number),
    pr.title,
    pr.headRefName,
    pr.url,
    author || prAuthorLogin(pr),
    workspaceName,
    pr.repoPath,
  ].join(' ');
}

export function threadSearchText(
  thread: Pick<Thread, 'title' | 'sourceRef' | 'sourceType' | 'agent' | 'status' | 'repoPath' | 'branchName' | 'prUrl'>,
  workspaceName = '',
): string {
  return [
    thread.title,
    thread.sourceRef,
    thread.sourceType,
    thread.agent,
    thread.status,
    thread.branchName,
    thread.prUrl ?? '',
    workspaceName,
    thread.repoPath,
  ].join(' ');
}

export function inWorkspace(
  repoPath: string,
  filterRepoPath: string,
): boolean {
  if (!filterRepoPath) return true;
  return repoPath === filterRepoPath;
}

export function visiblePage<T>(items: T[], shown: number): { visible: T[]; hidden: number } {
  const n = Math.max(0, shown);
  return {
    visible: items.slice(0, n),
    hidden: Math.max(0, items.length - n),
  };
}

export function compactPreview(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(1, max - 1))}…`;
}
