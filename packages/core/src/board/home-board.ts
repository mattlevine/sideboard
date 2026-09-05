import {
  normalizeWorktreePath,
  worktreeDisplayLabelForGroup,
} from '../git/worktree-labels.js';
import type { IssueInfo, PrInfo, Thread } from '../types/thread.js';

/** Keep in sync with store/global-workspace GLOBAL_WORKSPACE_ID (avoid importing that file — Node). */
const GLOBAL_WORKSPACE_ID = '__global__';

/**
 * Home Kanban work item — every worktree checkout, however it was created
 * (sidebar Create, MCP create_thread, adopt,
 * cowboy). Sibling chat tabs share one card. Orchestration / Global chats
 * stay in the sidebar, not the board.
 */
export function isHomeBoardThread(
  thread: Pick<Thread, 'sourceType' | 'repoPath'>,
): boolean {
  if (thread.sourceType === 'orchestration') return false;
  if (thread.repoPath === GLOBAL_WORKSPACE_ID) return false;
  return true;
}

export type BoardColumnId =
  | 'backlog'
  | 'queued'
  | 'running'
  | 'new'
  | 'draft'
  | 'review'
  | 'done';

export const BOARD_COLUMN_DEFS: { id: BoardColumnId; title: string }[] = [
  { id: 'new', title: 'New' },
  { id: 'draft', title: 'Draft' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Merged' },
];

/** Issue card on Home — `repoPath` is where Start will create the worktree. */
export type BoardIssue = IssueInfo & {
  repoPath: string;
  /** Linear / unknown + multiple workspaces: show a compact picker before Start. */
  needsWorkspacePick: boolean;
};

/** Open PR listed from a workspace (picker + metadata sync). */
export type BoardPr = PrInfo & {
  repoPath: string;
};

export type BoardPinKind = 'ticket' | 'pr' | 'branch';

/** User-pulled Home card. Remote fields refresh from Linear/GitHub; membership is local. */
export type BoardPin = {
  id: string;
  kind: BoardPinKind;
  ref: string;
  repoPath: string;
  addedAt: string;
  title: string;
  url?: string;
  labels?: string[];
  provider?: IssueInfo['provider'];
  assignee?: string;
  cycle?: string;
  teamKey?: string;
  headRefName?: string;
  author?: string;
  remoteState?: string;
  needsWorkspacePick: boolean;
};

export type AddBoardPinInput = {
  kind: BoardPinKind;
  ref: string;
  repoPath: string;
  title?: string;
  url?: string;
  labels?: string[];
  provider?: IssueInfo['provider'];
  assignee?: string;
  cycle?: string;
  teamKey?: string;
  headRefName?: string;
  author?: string;
  workspaceCount?: number;
};

/** How long Home / list_board reuse Linear + GitHub results before a refresh. */
export const HOME_BOARD_CACHE_TTL_MS = 15 * 60 * 1000;

/** Remote ticket + PR snapshot (no threads — those stay live). */
export type HomeBoardRemoteData = {
  issues: BoardIssue[];
  prs: BoardPr[];
  issueSource: string;
  viewerLogin?: string;
  issueErrors: string[];
  prErrors: string[];
};

export type HomeBoardLoaded = HomeBoardRemoteData & {
  fetchedAt: number;
  fromCache: boolean;
  pins: BoardPin[];
};

export function isOpenPrState(
  prUrl: string | null | undefined,
  prState: string | null | undefined,
): boolean {
  if (!prUrl?.trim()) return false;
  const state = (prState ?? 'OPEN').trim().toUpperCase();
  return state !== 'MERGED' && state !== 'CLOSED';
}

export function isMergedPrState(
  prUrl: string | null | undefined,
  prState: string | null | undefined,
): boolean {
  if (!prUrl?.trim()) return false;
  return (prState ?? '').trim().toUpperCase() === 'MERGED';
}

/**
 * Derived Home column. Path is PR state — not archive or live agent activity.
 * Archived chats leave the board (Settings → History). Queued/running stay on
 * the card (status icon) and the fleet bar.
 * Priority: merged PR → open (ready-for-review) PR → draft PR → no PR.
 */
export function classifyThreadColumn(
  thread: Pick<Thread, 'prUrl' | 'prState' | 'prIsDraft'>,
): BoardColumnId {
  if (isMergedPrState(thread.prUrl, thread.prState)) return 'done';
  if (isOpenPrState(thread.prUrl, thread.prState)) {
    return thread.prIsDraft ? 'draft' : 'review';
  }
  return 'new';
}

/** How worktree rows/cards are ordered. Default `created` stays put while agents run. */
export type WorktreeSortMode = 'created' | 'name' | 'activity';

export const DEFAULT_WORKTREE_SORT: WorktreeSortMode = 'created';

function groupCreatedAt<T extends Pick<Thread, 'createdAt'>>(group: T[]): string {
  let min = group[0]?.createdAt ?? '';
  for (const t of group) {
    if (t.createdAt && t.createdAt < min) min = t.createdAt;
  }
  return min;
}

function groupUpdatedAt<T extends Pick<Thread, 'updatedAt'>>(group: T[]): string {
  let max = group[0]?.updatedAt ?? '';
  for (const t of group) {
    if (t.updatedAt && t.updatedAt > max) max = t.updatedAt;
  }
  return max;
}

/** Sibling chats on one checkout — oldest tab first so the primary id stays stable. */
export function sortThreadsInWorktree<T extends Pick<Thread, 'createdAt' | 'id'>>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const created = a.createdAt.localeCompare(b.createdAt);
    if (created !== 0) return created;
    return a.id.localeCompare(b.id);
  });
}

export function compareWorktreeGroups<T extends Pick<Thread, 'createdAt' | 'updatedAt' | 'id'>>(
  a: T[],
  b: T[],
  mode: WorktreeSortMode,
  labelOf?: (group: T[]) => string,
): number {
  if (mode === 'name') {
    const named = (labelOf?.(a) ?? a[0]?.id ?? '').localeCompare(
      labelOf?.(b) ?? b[0]?.id ?? '',
      undefined,
      { sensitivity: 'base' },
    );
    if (named !== 0) return named;
  } else if (mode === 'activity') {
    const activity = groupUpdatedAt(b).localeCompare(groupUpdatedAt(a));
    if (activity !== 0) return activity;
  } else {
    const created = groupCreatedAt(b).localeCompare(groupCreatedAt(a));
    if (created !== 0) return created;
  }
  return (a[0]?.id ?? '').localeCompare(b[0]?.id ?? '');
}

function defaultWorktreeGroupLabel<
  T extends Pick<Thread, 'branchName' | 'worktreePath' | 'createdAt' | 'title' | 'prTitle' | 'userSetTitle'>,
>(group: T[]): string {
  return worktreeDisplayLabelForGroup(group);
}

/**
 * Live Home / sidebar threads grouped by checkout.
 * Groups default to newest-created first so a running agent does not reshuffle the list.
 * One card per group — extra chat tabs do not get their own column slot.
 */
export function groupHomeBoardWorktrees<
  T extends Pick<
    Thread,
    | 'worktreePath'
    | 'updatedAt'
    | 'createdAt'
    | 'id'
    | 'branchName'
    | 'title'
    | 'prTitle'
    | 'userSetTitle'
  >,
>(
  threads: T[],
  sort: WorktreeSortMode = DEFAULT_WORKTREE_SORT,
  labelOf: (group: T[]) => string = defaultWorktreeGroupLabel,
): T[][] {
  const map = new Map<string, T[]>();
  for (const t of threads) {
    const key = normalizeWorktreePath(t.worktreePath);
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return [...map.values()]
    .map((list) => sortThreadsInWorktree(list))
    .sort((a, b) => compareWorktreeGroups(a, b, sort, labelOf));
}

/** Column for a worktree: merged → Merged, open non-draft → Review, draft → Draft. */
export function classifyWorktreeColumn(
  group: Array<Pick<Thread, 'prUrl' | 'prState' | 'prIsDraft'>>,
): BoardColumnId {
  if (group.some((t) => isMergedPrState(t.prUrl, t.prState))) return 'done';
  if (group.some((t) => isOpenPrState(t.prUrl, t.prState) && !t.prIsDraft)) {
    return 'review';
  }
  if (group.some((t) => isOpenPrState(t.prUrl, t.prState) && t.prIsDraft)) {
    return 'draft';
  }
  return 'new';
}

/** Activity dot for a worktree: running / queued beat idle sibling tabs. */
export function worktreeBoardStatus(group: Array<Pick<Thread, 'status'>>): Thread['status'] {
  const order: Thread['status'][] = ['running', 'queued', 'error', 'broken'];
  for (const status of order) {
    if (group.some((t) => t.status === status)) return status;
  }
  return group[0]?.status ?? 'idle';
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
  const refRaw = (thread.sourceRef ?? '').trim().toLowerCase();
  const refKey = normalizeIssueKey(thread.sourceRef ?? '');
  const threadTitle = (thread.title ?? '').trim().toLowerCase();

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

/** Account-wide trackers are fetched once, not per workspace. */
export function isAccountWideIssueSource(source: string | undefined): boolean {
  return source === 'linear' || source === 'abletime';
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

/** True when `prUrl` is GitHub PR `number` (`…/pull/12` or `…/pull/12/…`). */
export function threadPrUrlMatchesNumber(
  thread: Pick<Thread, 'prUrl'>,
  number: number,
): boolean {
  if (!Number.isFinite(number) || number < 1) return false;
  const url = (thread.prUrl ?? '').trim();
  if (!url) return false;
  return new RegExp(`/pull/${number}(?:/|$|[?#])`, 'i').test(url);
}

/** Live thread for this PR: sourceType=pr + number, prUrl, or head branch. */
export function threadMatchesPr(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName'>,
  pr: Pick<PrInfo, 'number' | 'title' | 'url' | 'headRefName'>,
): boolean {
  const num = String(pr.number);
  if (thread.sourceType === 'pr' && normalizeIssueKey(thread.sourceRef ?? '') === num) {
    return true;
  }
  if (thread.prUrl && pr.url && urlsMatch(thread.prUrl, pr.url)) return true;
  if (threadPrUrlMatchesNumber(thread, pr.number)) return true;
  const head = pr.headRefName.trim().toLowerCase();
  if (!head) return false;
  const branch = (thread.branchName ?? '').trim().toLowerCase();
  const ref = (thread.sourceRef ?? '')
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

function normalizeBranchRef(value: string): string {
  return value
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '')
    .toLowerCase();
}

export function threadMatchesBranch(
  thread: Pick<Thread, 'sourceType' | 'sourceRef' | 'branchName' | 'repoPath'>,
  pin: Pick<BoardPin, 'ref' | 'repoPath'>,
): boolean {
  if (pin.repoPath && thread.repoPath && pin.repoPath !== thread.repoPath) return false;
  const head = normalizeBranchRef(pin.ref === 'default' ? '' : pin.ref);
  if (!head) {
    return thread.sourceType === 'branch' && pin.repoPath === thread.repoPath;
  }
  const branch = normalizeBranchRef(thread.branchName ?? '');
  const ref = normalizeBranchRef(thread.sourceRef ?? '');
  return branch === head || ref === head;
}

function sameRepoPath(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

const DEFAULTISH_BRANCH = /^(main|master|develop|development|trunk|default|head)$/;

/** New isolated worktree from the repo default — never reuse an existing card. */
export function isDefaultBranchCreateRef(ref: string): boolean {
  const head = normalizeBranchRef(ref);
  return !head || DEFAULTISH_BRANCH.test(head);
}

export type LiveCreateMatchThread = Pick<
  Thread,
  | 'id'
  | 'status'
  | 'sourceType'
  | 'sourceRef'
  | 'title'
  | 'prUrl'
  | 'branchName'
  | 'repoPath'
  | 'cowboy'
>;

export type FindLiveThreadForCreateInput = {
  sourceType: Exclude<Thread['sourceType'], 'orchestration'>;
  sourceRef: string;
  repoPath: string;
  title?: string;
  cowboy?: boolean;
  /** When creating from a PR (or a named branch that already has one). */
  prUrl?: string;
  headRefName?: string;
};

/**
 * Live worktree already covering this create (ticket, PR, or named branch).
 * Default-branch / "new worktree" creates return undefined so each one stays isolated.
 */
export function findLiveThreadForCreate<T extends LiveCreateMatchThread>(
  input: FindLiveThreadForCreateInput,
  threads: T[],
): T | undefined {
  const live = threads.filter(
    (t) => t.status !== 'archived' && sameRepoPath(t.repoPath, input.repoPath),
  );

  if (input.cowboy) {
    return live.find((t) => t.cowboy);
  }

  if (input.sourceType === 'ticket') {
    return live.find((t) =>
      threadMatchesIssue(t, {
        identifier: input.sourceRef,
        title: input.title ?? '',
      }),
    );
  }

  if (input.sourceType === 'pr') {
    const number = Number(normalizeIssueKey(input.sourceRef));
    return live.find((t) =>
      threadMatchesPr(t, {
        number: Number.isFinite(number) ? number : -1,
        title: input.title ?? '',
        url: input.prUrl ?? '',
        headRefName: input.headRefName ?? '',
      }),
    );
  }

  if (input.sourceType === 'branch') {
    if (isDefaultBranchCreateRef(input.sourceRef)) return undefined;
    const byBranch = live.find((t) =>
      threadMatchesBranch(t, {
        ref: input.sourceRef,
        repoPath: input.repoPath,
      }),
    );
    if (byBranch) return byBranch;
    if (input.prUrl || input.headRefName) {
      const number = Number(normalizeIssueKey(input.sourceRef));
      return live.find((t) =>
        threadMatchesPr(t, {
          number: Number.isFinite(number) ? number : -1,
          title: input.title ?? '',
          url: input.prUrl ?? '',
          headRefName: input.headRefName ?? input.sourceRef,
        }),
      );
    }
    return undefined;
  }

  return undefined;
}

export type CreateFromSourceKind = 'ticket' | 'pr' | 'branch';

/**
 * Occupied create target: same ticket, PR, or named branch already has a live
 * worktree (including PR ↔ head-branch when `prs` is provided).
 */
export function findLiveThreadForCreateSource<T extends LiveCreateMatchThread>(
  source: {
    kind: CreateFromSourceKind;
    ref: string;
    repoPath: string;
    title?: string;
    url?: string;
    headRefName?: string;
  },
  threads: T[],
  prs?: Array<Pick<PrInfo, 'number' | 'title' | 'url' | 'headRefName'>>,
): T | undefined {
  const found = findLiveThreadForCreate(
    {
      sourceType: source.kind,
      sourceRef: source.ref,
      repoPath: source.repoPath,
      title: source.title,
      prUrl: source.url,
      headRefName: source.headRefName,
    },
    threads,
  );
  if (found) return found;
  if (source.kind !== 'branch' || !prs?.length) return undefined;
  if (isDefaultBranchCreateRef(source.ref)) return undefined;
  const head = normalizeBranchRef(source.ref);
  const pr = prs.find((p) => normalizeBranchRef(p.headRefName) === head);
  if (!pr) return undefined;
  return findLiveThreadForCreate(
    {
      sourceType: 'pr',
      sourceRef: String(pr.number),
      repoPath: source.repoPath,
      title: pr.title,
      prUrl: pr.url,
      headRefName: pr.headRefName,
    },
    threads,
  );
}

export function threadMatchesPin(
  thread: Pick<
    Thread,
    'status' | 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName' | 'repoPath'
  >,
  pin: BoardPin,
): boolean {
  if (pin.kind === 'ticket') {
    return threadMatchesIssue(thread, { identifier: pin.ref, title: pin.title });
  }
  if (pin.kind === 'pr') {
    const number = Number(normalizeIssueKey(pin.ref));
    return threadMatchesPr(thread, {
      number: Number.isFinite(number) ? number : -1,
      title: pin.title,
      url: pin.url ?? '',
      headRefName: pin.headRefName ?? '',
    });
  }
  return threadMatchesBranch(thread, pin);
}

export function pinHasLiveThread(
  pin: BoardPin,
  threads: Pick<
    Thread,
    'status' | 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName' | 'repoPath'
  >[],
): boolean {
  return threads.some((t) => t.status !== 'archived' && threadMatchesPin(t, pin));
}

export function backlogPins(
  pins: BoardPin[],
  threads: Pick<
    Thread,
    'status' | 'sourceType' | 'sourceRef' | 'title' | 'prUrl' | 'branchName' | 'repoPath'
  >[],
): BoardPin[] {
  return pins.filter((pin) => !pinHasLiveThread(pin, threads));
}

export function boardPinIdentity(
  pin: Pick<BoardPin, 'kind' | 'ref' | 'repoPath' | 'provider'>,
): string {
  const ref = normalizeIssueKey(pin.ref);
  if (pin.kind === 'ticket' && (pin.provider === 'linear' || !pin.repoPath)) {
    return `ticket:account:${ref}`;
  }
  return `${pin.kind}:${pin.repoPath}:${ref}`;
}

export function boardPinKey(pin: Pick<BoardPin, 'id'>): string {
  return pin.id;
}

export function findBoardPin(
  pins: BoardPin[],
  kind: BoardPinKind,
  ref: string,
  repoPath = '',
): BoardPin | undefined {
  const key = normalizeIssueKey(ref);
  const matches = pins.filter(
    (pin) => pin.kind === kind && normalizeIssueKey(pin.ref) === key,
  );
  if (repoPath) {
    const scoped = matches.filter((pin) => pin.repoPath === repoPath);
    if (scoped[0]) return scoped[0];
  }
  return matches[0];
}

/** Overlay Linear/GitHub fields onto pulled cards. Missing remotes stay on the board. */
export function syncBoardPins(
  pins: BoardPin[],
  issues: BoardIssue[],
  prs: BoardPr[],
): BoardPin[] {
  return pins.map((pin) => {
    if (pin.kind === 'ticket') {
      const issue = findBoardIssue(issues, pin.ref, pin.repoPath);
      if (!issue) {
        return { ...pin, remoteState: pin.remoteState || 'stale' };
      }
      return {
        ...pin,
        title: issue.title || pin.title,
        url: issue.url || pin.url,
        labels: issue.labels,
        provider: issue.provider ?? pin.provider,
        assignee: issue.assignee ?? pin.assignee,
        cycle: issue.cycle?.name ?? pin.cycle,
        teamKey: issue.teamKey ?? pin.teamKey,
        remoteState: 'open',
        needsWorkspacePick: issue.needsWorkspacePick,
      };
    }
    if (pin.kind === 'pr') {
      const pr = findBoardPr(prs, pin.ref, pin.repoPath);
      if (!pr) {
        return { ...pin, remoteState: pin.remoteState === 'open' ? 'stale' : pin.remoteState || 'stale' };
      }
      return {
        ...pin,
        title: pr.title || pin.title,
        url: pr.url || pin.url,
        headRefName: pr.headRefName || pin.headRefName,
        author: prAuthorLogin(pr) || pin.author,
        remoteState: 'open',
      };
    }
    return pin;
  });
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

export type BoardKindFilter = 'all' | 'tickets' | 'prs' | 'branches' | 'threads';

/** Who / which sprint the Create-from ticket list includes. */
export type TicketScope = 'cycle' | 'assigned' | 'unassigned' | 'all';

/** Linear is already assigned-to-you (same as Conductor). GitHub / AbleTime default to all open. */
export function defaultTicketScope(issueSource: string): TicketScope {
  return issueSource === 'linear' ? 'assigned' : 'all';
}

export function issueAssignedToViewer(
  issue: Pick<IssueInfo, 'assignees' | 'assignee'>,
  viewerLogin = '',
): boolean {
  const me = viewerLogin.trim().toLowerCase();
  if (!me) return false;
  const names = [
    ...(issue.assignees ?? []),
    issue.assignee ?? '',
  ]
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  return names.includes(me);
}

/** Linear “assigned” is filtered in the API when the list is assigned-only; mixed lists use viewer login. */
export function issueInTicketScope(
  issue: Pick<IssueInfo, 'provider' | 'assignees' | 'assignee' | 'cycle'>,
  scope: TicketScope,
  viewerLogin = '',
): boolean {
  if (scope === 'all') return true;
  if (scope === 'unassigned') {
    const names = [
      ...(issue.assignees ?? []),
      issue.assignee ?? '',
    ]
      .map((n) => n.trim())
      .filter(Boolean);
    return names.length === 0;
  }
  if (scope === 'cycle') {
    if (issue.provider === 'linear' || issue.cycle) {
      return Boolean(issue.cycle?.isActive);
    }
    return issueAssignedToViewer(issue, viewerLogin);
  }
  if (issue.provider === 'linear') return true;
  if (!viewerLogin.trim()) return true;
  return issueAssignedToViewer(issue, viewerLogin);
}

export function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function haystackMatches(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const h = haystack.toLowerCase();
  return tokens.every((token) => h.includes(token));
}

export function issueSearchText(
  issue: Pick<
    BoardIssue,
    | 'identifier'
    | 'title'
    | 'labels'
    | 'provider'
    | 'repoPath'
    | 'assignee'
    | 'assignees'
    | 'cycle'
    | 'teamKey'
  >,
  workspaceName = '',
): string {
  return [
    issue.identifier,
    issue.title,
    issue.labels.join(' '),
    issue.provider ?? '',
    issue.assignee ?? '',
    (issue.assignees ?? []).join(' '),
    issue.cycle?.name ?? '',
    issue.teamKey ?? '',
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

export function pinSearchText(pin: BoardPin, workspaceName = ''): string {
  return [
    pin.kind,
    pin.ref,
    pin.title,
    (pin.labels ?? []).join(' '),
    pin.provider ?? '',
    pin.assignee ?? '',
    pin.cycle ?? '',
    pin.teamKey ?? '',
    pin.headRefName ?? '',
    pin.author ?? '',
    pin.remoteState ?? '',
    workspaceName,
    pin.repoPath,
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
  id?: string;
  identifier: string;
  title: string;
  labels: string[];
  provider?: string;
  repoPath: string;
  url: string;
  assignee?: string;
  cycle?: string;
  teamKey?: string;
  remoteState?: string;
  needsWorkspacePick?: boolean;
};

export type HomeBoardPrCard = {
  kind: 'pr';
  id?: string;
  number: number;
  title: string;
  headRefName: string;
  repoPath: string;
  url: string;
  author: string;
  remoteState?: string;
};

export type HomeBoardBranchCard = {
  kind: 'branch';
  id: string;
  ref: string;
  title: string;
  repoPath: string;
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
  /** Live chat tabs on this checkout. Omitted when 1. */
  chatCount?: number;
};

export type HomeBoardCard =
  | HomeBoardTicketCard
  | HomeBoardPrCard
  | HomeBoardBranchCard
  | HomeBoardThreadCard;

export type HomeBoardSnapshot = {
  columns: Record<BoardColumnId, HomeBoardCard[]>;
  hidden: Record<BoardColumnId, number>;
  totals: Record<BoardColumnId, number> & {
    tickets: number;
    prs: number;
    branches: number;
    threads: number;
  };
};

function emptyColumns(): Record<BoardColumnId, HomeBoardCard[]> {
  return {
    backlog: [],
    queued: [],
    running: [],
    new: [],
    draft: [],
    review: [],
    done: [],
  };
}

function emptyHidden(): Record<BoardColumnId, number> {
  return {
    backlog: 0,
    queued: 0,
    running: 0,
    new: 0,
    draft: 0,
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

function toThreadCard(group: Thread[]): HomeBoardThreadCard {
  const thread = group[0]!;
  const withPr = group.find((t) => t.prUrl?.trim()) ?? thread;
  return {
    kind: 'thread',
    id: thread.id,
    title: worktreeDisplayLabelForGroup(group),
    status: worktreeBoardStatus(group),
    agent: thread.agent,
    sourceType: thread.sourceType,
    sourceRef: thread.sourceRef,
    repoPath: thread.repoPath,
    prUrl: withPr.prUrl,
    link: `sideboard://thread/${thread.id}`,
    ...(group.length > 1 ? { chatCount: group.length } : {}),
  };
}

function threadMatchesKind(
  thread: Pick<Thread, 'sourceType'>,
  kind: BoardKindFilter,
): boolean {
  if (kind === 'all' || kind === 'threads') return true;
  if (kind === 'tickets') return thread.sourceType === 'ticket';
  if (kind === 'prs') return thread.sourceType === 'pr';
  if (kind === 'branches') return thread.sourceType === 'branch' || thread.sourceType === 'adopt';
  return true;
}

/** Same columns and filters as the desktop Home Kanban — for MCP + UI. */
export function assembleHomeBoard(input: {
  pins?: BoardPin[];
  /** @deprecated Home is worktree threads only. Kept so older callers still typecheck. */
  issues?: BoardIssue[];
  prs?: BoardPr[];
  threads: Thread[];
  /** @deprecated Archived chats are History, not a Home column. Ignored. */
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
  const live = input.threads.filter((t) => t.status !== 'archived' && isHomeBoardThread(t));

  const columns = emptyColumns();
  const hidden = emptyHidden();
  const totals = {
    backlog: 0,
    queued: 0,
    running: 0,
    new: 0,
    draft: 0,
    review: 0,
    done: 0,
    tickets: 0,
    prs: 0,
    branches: 0,
    threads: 0,
  };

  const byCol: Record<Exclude<BoardColumnId, 'backlog'>, Thread[][]> = {
    queued: [],
    running: [],
    new: [],
    draft: [],
    review: [],
    done: [],
  };
  for (const group of groupHomeBoardWorktrees(live)) {
    if (!group.some((t) => threadMatchesKind(t, kind))) continue;
    const col = classifyWorktreeColumn(group);
    if (col === 'backlog') continue;
    const primary = group[0]!;
    if (!inWorkspace(primary.repoPath, repo)) continue;
    const hay = group.map((t) => threadSearchText(t, wsName(t.repoPath))).join(' ');
    if (!haystackMatches(hay, tokens)) continue;
    byCol[col].push(group);
  }

  const flat = [...Object.values(byCol)].flatMap((groups) => groups.map((g) => g[0]!));
  totals.tickets = flat.filter((t) => t.sourceType === 'ticket').length;
  totals.prs = flat.filter((t) => t.sourceType === 'pr').length;
  totals.branches = flat.filter((t) => t.sourceType === 'branch' || t.sourceType === 'adopt').length;
  totals.threads = Object.values(byCol).reduce((n, list) => n + list.length, 0);

  for (const col of Object.keys(byCol) as Array<Exclude<BoardColumnId, 'backlog'>>) {
    const cards: HomeBoardCard[] = byCol[col].map(toThreadCard);
    totals[col] = cards.length;
    const page = visiblePage(cards, limit);
    columns[col] = page.visible;
    hidden[col] = page.hidden;
  }

  if (input.column) {
    for (const col of Object.keys(columns) as BoardColumnId[]) {
      if (col === input.column) continue;
      columns[col] = [];
      hidden[col] = 0;
    }
  }

  return { columns, hidden, totals };
}

export const HOME_BOARD_AGENT_HINT =
  'Home is a Kanban of worktrees (one card per checkout; sibling chat tabs nest as inner cards). Do not create a second worktree for a ticket, PR, or named branch that already has a live checkout — create_thread / start_board_card return that thread (alreadyStarted). Creating from the default branch still opens a new isolated worktree. Columns are the path to merge: New (no PR) → Draft (draft PR) → Review (open PR) → Merged. Archive removes the card to Settings → History. Queued/running are activity on the card, not columns. Orchestration chats stay in the sidebar. Do not invent status.';

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
