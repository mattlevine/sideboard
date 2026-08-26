import type { IssueInfo, PrInfo, Thread } from '../types/thread.js';

/** Keep in sync with store/global-workspace GLOBAL_WORKSPACE_ID (avoid importing that file — Node). */
const GLOBAL_WORKSPACE_ID = '__global__';

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
  workspaces: Array<{ path: string }>,
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

export type HomeBoardTicketCard = {
  kind: 'ticket';
  identifier: string;
  title: string;
  labels: string[];
  provider?: string;
  repoPath: string;
  url: string;
};

export type HomeBoardPrCard = {
  kind: 'pr';
  number: number;
  title: string;
  headRefName: string;
  repoPath: string;
  url: string;
  author: string;
};

export type HomeBoardThreadCard = {
  kind: 'thread';
  id: string;
  title: string;
  status: Thread['status'];
  agent: Thread['agent'];
  sourceType: Thread['sourceType'];
  sourceRef: string;
  repoPath: string;
  prUrl: string | null;
  link: string;
};

export type HomeBoardCard = HomeBoardTicketCard | HomeBoardPrCard | HomeBoardThreadCard;

export type HomeBoardSnapshot = {
  columns: Record<BoardColumnId, HomeBoardCard[]>;
  hidden: Record<BoardColumnId, number>;
  totals: Record<BoardColumnId, number> & {
    tickets: number;
    prs: number;
    threads: number;
  };
};

function emptyColumns(): Record<BoardColumnId, HomeBoardCard[]> {
  return {
    backlog: [],
    queued: [],
    running: [],
    needs_you: [],
    review: [],
    done: [],
  };
}

function emptyHidden(): Record<BoardColumnId, number> {
  return {
    backlog: 0,
    queued: 0,
    running: 0,
    needs_you: 0,
    review: 0,
    done: 0,
  };
}

/** Ticket card from a `list_board` / Start ref (`ENG-12`, `#44`). */
export function findBoardIssue(
  issues: BoardIssue[],
  ref: string,
  repoPath = '',
): BoardIssue | undefined {
  const key = normalizeIssueKey(ref);
  if (!key) return undefined;
  const matches = issues.filter((issue) => normalizeIssueKey(issue.identifier) === key);
  if (repoPath) {
    const scoped = matches.filter((issue) => issue.repoPath === repoPath);
    if (scoped[0]) return scoped[0];
  }
  return matches[0];
}

/** Unmatched Review PR from a Start ref (`44`, `#44`). */
export function findBoardPr(
  prs: BoardPr[],
  ref: string,
  repoPath = '',
): BoardPr | undefined {
  const num = Number(normalizeIssueKey(ref));
  if (!Number.isFinite(num)) return undefined;
  const matches = prs.filter((pr) => pr.number === num);
  if (repoPath) {
    const scoped = matches.filter((pr) => pr.repoPath === repoPath);
    if (scoped[0]) return scoped[0];
  }
  return matches[0];
}

function toTicketCard(issue: BoardIssue): HomeBoardTicketCard {
  return {
    kind: 'ticket',
    identifier: issue.identifier,
    title: issue.title,
    labels: issue.labels,
    provider: issue.provider,
    repoPath: issue.repoPath,
    url: issue.url,
  };
}

function toPrCard(pr: BoardPr): HomeBoardPrCard {
  return {
    kind: 'pr',
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    repoPath: pr.repoPath,
    url: pr.url,
    author: prAuthorLogin(pr),
  };
}

function toThreadCard(thread: Thread): HomeBoardThreadCard {
  return {
    kind: 'thread',
    id: thread.id,
    title: thread.title,
    status: thread.status,
    agent: thread.agent,
    sourceType: thread.sourceType,
    sourceRef: thread.sourceRef,
    repoPath: thread.repoPath,
    prUrl: thread.prUrl,
    link: `sideboard://thread/${thread.id}`,
  };
}

/** Same columns and filters as the desktop Home Kanban — for MCP + UI. */
export function assembleHomeBoard(input: {
  issues: BoardIssue[];
  prs: BoardPr[];
  threads: Thread[];
  archivedThreads?: Thread[];
  query?: string;
  repoPath?: string;
  kind?: BoardKindFilter;
  column?: BoardColumnId;
  limit?: number;
  workspaceName?: (path: string) => string;
}): HomeBoardSnapshot {
  const tokens = tokenizeQuery(input.query ?? '');
  const repo = input.repoPath?.trim() ?? '';
  const kind = input.kind ?? 'all';
  const limit = Math.max(1, input.limit ?? BOARD_PAGE_SIZE);
  const wsName = input.workspaceName ?? (() => '');
  const byUpdated = (a: Thread, b: Thread) => b.updatedAt.localeCompare(a.updatedAt);
  const live = input.threads.filter((t) => t.status !== 'archived').sort(byUpdated);
  const archived = (
    input.archivedThreads ?? input.threads.filter((t) => t.status === 'archived')
  ).sort(byUpdated);

  const tickets =
    kind === 'prs' || kind === 'threads'
      ? []
      : backlogIssues(input.issues, live).filter(
          (issue) =>
            inWorkspace(issue.repoPath, repo) &&
            haystackMatches(issueSearchText(issue, wsName(issue.repoPath)), tokens),
        );
  const prs =
    kind === 'tickets' || kind === 'threads'
      ? []
      : reviewPrs(input.prs, live).filter(
          (pr) =>
            inWorkspace(pr.repoPath, repo) &&
            haystackMatches(prSearchText(pr, wsName(pr.repoPath)), tokens),
        );

  const columns = emptyColumns();
  const hidden = emptyHidden();
  const totals = {
    backlog: 0,
    queued: 0,
    running: 0,
    needs_you: 0,
    review: 0,
    done: 0,
    tickets: tickets.length,
    prs: prs.length,
    threads: 0,
  };

  const backlogCards = tickets.map(toTicketCard);
  totals.backlog = backlogCards.length;
  const backlogPage = visiblePage(backlogCards, limit);
  columns.backlog = backlogPage.visible;
  hidden.backlog = backlogPage.hidden;

  const byCol: Record<Exclude<BoardColumnId, 'backlog'>, Thread[]> = {
    queued: [],
    running: [],
    needs_you: [],
    review: [],
    done: [],
  };
  if (kind !== 'tickets' && kind !== 'prs') {
    for (const t of live) {
      const col = classifyThreadColumn(t);
      if (col === 'backlog' || col === 'done') continue;
      if (!inWorkspace(t.repoPath, repo)) continue;
      if (!haystackMatches(threadSearchText(t, wsName(t.repoPath)), tokens)) continue;
      byCol[col].push(t);
    }
    for (const t of archived) {
      if (!inWorkspace(t.repoPath, repo)) continue;
      if (!haystackMatches(threadSearchText(t, wsName(t.repoPath)), tokens)) continue;
      byCol.done.push(t);
    }
  }

  totals.threads = Object.values(byCol).reduce((n, list) => n + list.length, 0);

  for (const col of Object.keys(byCol) as Array<Exclude<BoardColumnId, 'backlog'>>) {
    const cards: HomeBoardCard[] =
      col === 'review'
        ? [...prs.map(toPrCard), ...byCol.review.map(toThreadCard)]
        : byCol[col].map(toThreadCard);
    totals[col] = cards.length;
    const page = visiblePage(cards, limit);
    columns[col] = page.visible;
    hidden[col] = page.hidden;
  }

  if (input.column) {
    for (const col of BOARD_COLUMN_DEFS.map((d) => d.id)) {
      if (col === input.column) continue;
      columns[col] = [];
      hidden[col] = 0;
    }
  }

  return { columns, hidden, totals };
}

export const HOME_BOARD_AGENT_HINT =
  'Start a Backlog ticket: start_board_card kind=ticket ref=<identifier> repoPath=… (or create_thread sourceType=ticket). Start an unmatched Review PR: start_board_card kind=pr ref=<number> repoPath=…. Then send_to_thread. Columns follow agent/PR state — do not invent status.';

export function formatHomeBoardSnapshot(snap: HomeBoardSnapshot): string {
  return JSON.stringify(
    {
      columns: snap.columns,
      hidden: snap.hidden,
      totals: snap.totals,
      hint: HOME_BOARD_AGENT_HINT,
    },
    null,
    2,
  );
}
