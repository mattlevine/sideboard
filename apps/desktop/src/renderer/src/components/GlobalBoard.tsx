import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IssueInfo, OrchestratorRuntime, PrInfo, Thread, Workspace } from '@sideboard-ai/core';
import { CLOUD_ORCHESTRATOR_GOAL, threadDisplayTitle } from '../lib/global-workspace';
import {
  BOARD_COLUMN_DEFS,
  BOARD_PAGE_SIZE,
  HOME_BOARD_CACHE_TTL_MS,
  backlogIssues,
  boardIssueKey,
  boardPrKey,
  classifyThreadColumn,
  compactPreview,
  defaultTicketScope,
  haystackMatches,
  inWorkspace,
  isHomeBoardThread,
  issueInTicketScope,
  issueSearchText,
  issueSourceLabel,
  pickDefaultRepoPath,
  prAuthorLogin,
  prSearchText,
  reviewPrs,
  threadSearchText,
  tokenizeQuery,
  visiblePage,
  type BoardColumnId,
  type BoardIssue,
  type BoardKindFilter,
  type BoardPr,
  type TicketScope,
} from '../lib/home-board';

const TICKET_SCOPE_KEY = 'sideboard.homeTicketScope';

function readStoredTicketScope(): TicketScope | null {
  try {
    const raw = localStorage.getItem(TICKET_SCOPE_KEY);
    if (raw === 'cycle' || raw === 'assigned' || raw === 'all') return raw;
  } catch {
    // ignore
  }
  return null;
}

function persistTicketScope(scope: TicketScope) {
  try {
    localStorage.setItem(TICKET_SCOPE_KEY, scope);
  } catch {
    // ignore
  }
}
import { FleetActivityBar } from './FleetActivityBar';

interface Props {
  threads: Thread[];
  archivedThreads?: Thread[];
  workspaces?: Workspace[];
  lastUsedRepoPath?: string;
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  onOpenThread: (id: string) => void;
  onAddToBoard: () => void;
  onNewGlobalChat: () => void;
  onRefresh: () => void;
  onStartIssue?: (issue: IssueInfo, repoPath: string) => Promise<void>;
  onStartPr?: (pr: PrInfo, repoPath: string) => Promise<void>;
  /** Left-edge open control when the left sidebar is closed. */
  leftSidebarToggle?: ReactNode;
}

function relativeTime(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function previewForThread(
  t: Thread,
  live: string | undefined,
): { text: string; markdown: boolean } {
  if (live) return { text: live, markdown: true };
  if (t.lastError) return { text: t.lastError, markdown: false };
  const last = t.messages[t.messages.length - 1];
  if (last?.role === 'agent' || last?.role === 'user') {
    return { text: last.text, markdown: last.role === 'agent' };
  }
  if (t.sourceRef?.trim() && t.sourceRef !== CLOUD_ORCHESTRATOR_GOAL) {
    return { text: t.sourceRef, markdown: false };
  }
  return { text: '', markdown: false };
}

function workspaceName(path: string, workspaces: Workspace[]): string {
  return workspaces.find((w) => w.path === path)?.name
    || path.split('/').filter(Boolean).pop()
    || path;
}

export function GlobalBoard({
  threads,
  archivedThreads = [],
  workspaces = [],
  lastUsedRepoPath = '',
  runtime,
  liveByThread,
  onOpenThread,
  onAddToBoard,
  onNewGlobalChat,
  onRefresh,
  onStartIssue,
  onStartPr,
  leftSidebarToggle,
}: Props) {
  const [issues, setIssues] = useState<BoardIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issueSource, setIssueSource] = useState<string>('github');
  const [viewerLogin, setViewerLogin] = useState('');
  const [ticketScopeOverride, setTicketScopeOverride] = useState<TicketScope | null>(
    readStoredTicketScope,
  );
  const [prs, setPrs] = useState<BoardPr[]>([]);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [remoteReq, setRemoteReq] = useState({ n: 0, refresh: false });
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [doneOpen, setDoneOpen] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<Record<string, string>>({});
  const [pickedRepo, setPickedRepo] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [repoFilter, setRepoFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<BoardKindFilter>('all');
  const [shownByCol, setShownByCol] = useState<Partial<Record<BoardColumnId, number>>>({});

  const workspaceKey = useMemo(
    () => workspaces.map((w) => w.path).filter(Boolean).sort().join('\n'),
    [workspaces],
  );

  useEffect(() => {
    let cancelled = false;
    const paths = workspaceKey ? workspaceKey.split('\n') : [];
    if (paths.length === 0) {
      setIssues([]);
      setIssuesLoading(false);
      setIssuesError(null);
      setPrs([]);
      setPrsLoading(false);
      setPrsError(null);
      setFetchedAt(null);
      return;
    }

    const refresh = remoteReq.refresh;
    setIssuesLoading(true);
    setIssuesError(null);
    setPrsLoading(true);
    setPrsError(null);

    void (async () => {
      try {
        const loaded = await window.sideboard.loadHomeBoard({ refresh });
        if (cancelled) return;
        setIssueSource(loaded.issueSource);
        setViewerLogin(loaded.viewerLogin || '');
        setIssues(loaded.issues);
        setPrs(loaded.prs);
        setIssuesError(loaded.issueErrors[0] ?? null);
        setPrsError(loaded.prErrors[0] ?? null);
        setFetchedAt(loaded.fetchedAt);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setIssuesError(message);
        setPrsError(message);
        setIssues([]);
        setPrs([]);
        setFetchedAt(null);
      } finally {
        if (!cancelled) {
          setIssuesLoading(false);
          setPrsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceKey, remoteReq]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!fetchedAt) return;
    const remaining = HOME_BOARD_CACHE_TTL_MS - (Date.now() - fetchedAt);
    const wait = Math.max(remaining, 5_000);
    const id = window.setTimeout(() => {
      setRemoteReq((prev) => ({ n: prev.n + 1, refresh: false }));
    }, wait);
    return () => window.clearTimeout(id);
  }, [fetchedAt, workspaceKey]);

  const defaultRepo = pickDefaultRepoPath(workspaces, lastUsedRepoPath);
  const ticketScope = ticketScopeOverride ?? defaultTicketScope(issueSource);

  function chooseTicketScope(scope: TicketScope) {
    setTicketScopeOverride(scope);
    persistTicketScope(scope);
  }

  const boardIssues = useMemo(() => {
    return issues.map((issue) => {
      if (issue.provider === 'github') return issue;
      return {
        ...issue,
        repoPath: pickedRepo[boardIssueKey(issue)] || defaultRepo || issue.repoPath,
      };
    });
  }, [issues, pickedRepo, defaultRepo]);

  const liveThreads = useMemo(
    () =>
      threads
        .filter(isHomeBoardThread)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );
  const doneThreads = useMemo(
    () =>
      archivedThreads
        .filter(isHomeBoardThread)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [archivedThreads],
  );

  const backlog = useMemo(
    () => backlogIssues(boardIssues, liveThreads),
    [boardIssues, liveThreads],
  );

  const inboxPrs = useMemo(
    () => reviewPrs(prs, liveThreads),
    [prs, liveThreads],
  );

  const queryTokens = useMemo(() => tokenizeQuery(query), [query]);

  useEffect(() => {
    setShownByCol({});
  }, [query, repoFilter, kindFilter, ticketScope]);

  const filteredBacklog = useMemo(() => {
    if (kindFilter === 'prs' || kindFilter === 'threads') return [];
    return backlog.filter(
      (issue) =>
        issueInTicketScope(issue, ticketScope, viewerLogin) &&
        inWorkspace(issue.repoPath, repoFilter) &&
        haystackMatches(
          issueSearchText(issue, workspaceName(issue.repoPath, workspaces)),
          queryTokens,
        ),
    );
  }, [backlog, kindFilter, repoFilter, queryTokens, workspaces, ticketScope, viewerLogin]);

  const filteredPrs = useMemo(() => {
    if (kindFilter === 'tickets' || kindFilter === 'threads') return [];
    return inboxPrs.filter(
      (pr) =>
        inWorkspace(pr.repoPath, repoFilter) &&
        haystackMatches(
          prSearchText(pr, workspaceName(pr.repoPath, workspaces)),
          queryTokens,
        ),
    );
  }, [inboxPrs, kindFilter, repoFilter, queryTokens, workspaces]);

  const byColumn = useMemo(() => {
    const map: Record<Exclude<BoardColumnId, 'backlog'>, Thread[]> = {
      queued: [],
      running: [],
      needs_you: [],
      review: [],
      done: [],
    };
    for (const t of liveThreads) {
      const col = classifyThreadColumn(t);
      if (col === 'backlog' || col === 'done') continue;
      map[col].push(t);
    }
    map.done = doneThreads;
    return map;
  }, [liveThreads, doneThreads]);

  const filteredByColumn = useMemo(() => {
    const map: Record<Exclude<BoardColumnId, 'backlog'>, Thread[]> = {
      queued: [],
      running: [],
      needs_you: [],
      review: [],
      done: [],
    };
    if (kindFilter === 'tickets' || kindFilter === 'prs') return map;
    for (const col of Object.keys(map) as Array<Exclude<BoardColumnId, 'backlog'>>) {
      map[col] = byColumn[col].filter(
        (t) =>
          inWorkspace(t.repoPath, repoFilter) &&
          haystackMatches(
            threadSearchText(t, workspaceName(t.repoPath, workspaces)),
            queryTokens,
          ),
      );
    }
    return map;
  }, [byColumn, kindFilter, repoFilter, queryTokens, workspaces]);

  const filteredThreadCount = useMemo(
    () => Object.values(filteredByColumn).reduce((n, list) => n + list.length, 0),
    [filteredByColumn],
  );

  const hasBoardContent =
    issuesLoading ||
    prsLoading ||
    Boolean(issuesError) ||
    Boolean(prsError) ||
    backlog.length > 0 ||
    inboxPrs.length > 0 ||
    liveThreads.length > 0 ||
    doneThreads.length > 0;

  function handleRefresh() {
    setRemoteReq((prev) => ({ n: prev.n + 1, refresh: true }));
    onRefresh();
  }

  function shownFor(col: BoardColumnId): number {
    return shownByCol[col] ?? BOARD_PAGE_SIZE;
  }

  function showMore(col: BoardColumnId) {
    setShownByCol((prev) => ({
      ...prev,
      [col]: (prev[col] ?? BOARD_PAGE_SIZE) + BOARD_PAGE_SIZE,
    }));
  }

  function countLabel(visible: number, total: number): string {
    if (total <= visible) return String(total);
    return `${visible} of ${total}`;
  }

  async function handleStart(issue: BoardIssue) {
    const key = boardIssueKey(issue);
    const repo =
      pickedRepo[key]
      || (issue.provider === 'github' ? issue.repoPath : defaultRepo)
      || issue.repoPath;
    if (!repo) {
      setStartError((prev) => ({
        ...prev,
        [key]: 'Add a workspace first',
      }));
      return;
    }
    if (!onStartIssue) return;
    setStartingId(key);
    setStartError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await onStartIssue(issue, repo);
    } catch (err) {
      setStartError((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStartingId((id) => (id === key ? null : id));
    }
  }

  async function handleStartPr(pr: BoardPr) {
    const key = boardPrKey(pr);
    if (!pr.repoPath) {
      setStartError((prev) => ({ ...prev, [key]: 'Add a workspace first' }));
      return;
    }
    if (!onStartPr) return;
    setStartingId(key);
    setStartError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await onStartPr(pr, pr.repoPath);
    } catch (err) {
      setStartError((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStartingId((id) => (id === key ? null : id));
    }
  }

  return (
    <section className="panel board">
      {leftSidebarToggle && (
        <div className="board-chrome">
          {leftSidebarToggle}
          <div className="board-chrome-spacer" />
        </div>
      )}
      <div className="panel-header">
        <h2>Home</h2>
        <span className="thread-meta">
          {runtime
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${filteredBacklog.length} tickets · ${filteredPrs.length} PRs · ${filteredThreadCount} thread${filteredThreadCount === 1 ? '' : 's'}`
            : '…'}
          {fetchedAt
            ? ` · updated ${relativeTime(new Date(fetchedAt).toISOString(), nowTick)}`
            : ''}
        </span>
        <div className="actions">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={issuesLoading || prsLoading}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onAddToBoard}
            title="Add a ticket or PR to the board"
          >
            Add to Board
          </button>
        </div>
      </div>

      {hasBoardContent ? (
        <>
          <FleetActivityBar runtime={runtime} compact />
          <p className="board-lede">
            Search and filter across tickets, PRs, and worktree chats. Every
            worktree appears here — Start, sidebar Create, or an orchestration
            agent. Tickets and PRs are a snapshot — Refresh (or 15 minutes)
            pulls Linear/GitHub again. Threads stay live. Linear Backlog
            defaults to issues assigned to you in the current cycle. Start
            opens a worktree; the card then follows agent and PR status.
          </p>
          <div className="board-toolbar">
            <input
              className="board-toolbar-search"
              type="search"
              placeholder="Search tickets, PRs, threads, labels, repos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {workspaces.length > 1 && (
              <select
                className="board-toolbar-select"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                aria-label="Workspace"
              >
                <option value="">All workspaces</option>
                {workspaces.map((w) => (
                  <option key={w.path} value={w.path}>{w.name}</option>
                ))}
              </select>
            )}
            <div className="board-toolbar-kinds" role="group" aria-label="Card type">
              {([
                { id: 'all' as const, label: 'All' },
                { id: 'tickets' as const, label: 'Tickets' },
                { id: 'prs' as const, label: 'PRs' },
                { id: 'threads' as const, label: 'Threads' },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={kindFilter === opt.id ? 'primary' : ''}
                  onClick={() => setKindFilter(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="board-toolbar-kinds" role="group" aria-label="Ticket scope">
              {issueSource === 'linear' ? (
                <>
                  <button
                    type="button"
                    className={ticketScope === 'cycle' ? 'primary' : ''}
                    onClick={() => chooseTicketScope('cycle')}
                  >
                    This cycle
                  </button>
                  <button
                    type="button"
                    className={ticketScope === 'assigned' ? 'primary' : ''}
                    onClick={() => chooseTicketScope('assigned')}
                  >
                    All assigned
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={ticketScope === 'all' ? 'primary' : ''}
                    onClick={() => chooseTicketScope('all')}
                  >
                    All open
                  </button>
                  <button
                    type="button"
                    className={ticketScope === 'assigned' || ticketScope === 'cycle' ? 'primary' : ''}
                    onClick={() => chooseTicketScope('assigned')}
                  >
                    Assigned to me
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="board-body board-kanban-wrap">
            <div className="board-kanban">
              {BOARD_COLUMN_DEFS.map((col) => {
                if (col.id === 'backlog') {
                  const page = visiblePage(filteredBacklog, shownFor('backlog'));
                  return (
                    <section key={col.id} className="board-column">
                      <header className="board-column-header">
                        <h3>{col.title}</h3>
                        <span className="thread-meta">
                          {countLabel(page.visible.length, filteredBacklog.length)}
                        </span>
                      </header>
                      <div className="board-column-cards">
                        {issuesLoading && (
                          <div className="board-column-empty">Loading tickets…</div>
                        )}
                        {issuesError && !issuesLoading && (
                          <div className="board-column-empty">{issuesError}</div>
                        )}
                        {!issuesLoading && !issuesError && filteredBacklog.length === 0 && (
                          <div className="board-column-empty">
                            {query || repoFilter || kindFilter !== 'all'
                              ? 'No matching tickets'
                              : ticketScope === 'cycle' && issueSource === 'linear'
                                ? backlog.length > 0
                                  ? `No tickets in your current cycle (${backlog.length} assigned overall)`
                                  : 'No tickets in your current cycle'
                                : ticketScope === 'assigned'
                                  ? 'No tickets assigned to you'
                                  : `No ${issueSourceLabel(issueSource)} tickets`}
                          </div>
                        )}
                        {page.visible.map((issue) => {
                          const key = boardIssueKey(issue);
                          return (
                          <IssueCard
                            key={key}
                            issue={issue}
                            workspaces={workspaces}
                            pickedRepo={
                              pickedRepo[key]
                              || (issue.provider === 'github' ? issue.repoPath : defaultRepo)
                            }
                            onPickRepo={(path) =>
                              setPickedRepo((prev) => ({ ...prev, [key]: path }))
                            }
                            starting={startingId === key}
                            error={startError[key]}
                            onStart={() => void handleStart(issue)}
                            fallbackProvider={issueSource}
                          />
                          );
                        })}
                        {page.hidden > 0 && (
                          <button
                            type="button"
                            className="board-column-more"
                            onClick={() => showMore('backlog')}
                          >
                            Show {Math.min(BOARD_PAGE_SIZE, page.hidden)} more ({page.hidden} hidden)
                          </button>
                        )}
                      </div>
                    </section>
                  );
                }

                const cards = filteredByColumn[col.id];
                const reviewItems = col.id === 'review'
                  ? [
                      ...filteredPrs.map((pr) => ({ kind: 'pr' as const, pr })),
                      ...cards.map((thread) => ({ kind: 'thread' as const, thread })),
                    ]
                  : cards.map((thread) => ({ kind: 'thread' as const, thread }));
                const total = reviewItems.length;
                const page = visiblePage(reviewItems, shownFor(col.id));
                const collapsed = col.id === 'done' && !doneOpen;
                const showPrInbox = col.id === 'review' && !collapsed;
                return (
                  <section
                    key={col.id}
                    className={`board-column${col.id === 'done' ? ' is-done' : ''}`}
                  >
                    <header className="board-column-header">
                      <h3>{col.title}</h3>
                      <span className="thread-meta">{countLabel(collapsed ? 0 : page.visible.length, total)}</span>
                      {col.id === 'done' && (
                        <button
                          type="button"
                          className="board-column-toggle"
                          onClick={() => setDoneOpen((v) => !v)}
                        >
                          {doneOpen ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </header>
                    <div className="board-column-cards">
                      {collapsed ? (
                        <div className="board-column-empty">
                          {total === 0 ? 'None archived' : `${total} archived`}
                        </div>
                      ) : (
                        <>
                          {showPrInbox && prsLoading && (
                            <div className="board-column-empty">Loading PRs…</div>
                          )}
                          {showPrInbox && prsError && !prsLoading && (
                            <div className="board-column-empty">{prsError}</div>
                          )}
                          {page.visible.map((item) => {
                            if (item.kind === 'pr') {
                              const key = boardPrKey(item.pr);
                              return (
                                <PrCard
                                  key={key}
                                  pr={item.pr}
                                  workspaces={workspaces}
                                  starting={startingId === key}
                                  error={startError[key]}
                                  onStart={() => void handleStartPr(item.pr)}
                                />
                              );
                            }
                            return (
                              <ThreadCard
                                key={item.thread.id}
                                thread={item.thread}
                                live={liveByThread[item.thread.id]}
                                workspaces={workspaces}
                                onOpenThread={onOpenThread}
                                onRefresh={onRefresh}
                              />
                            );
                          })}
                          {page.hidden > 0 && (
                            <button
                              type="button"
                              className="board-column-more"
                              onClick={() => showMore(col.id)}
                            >
                              Show {Math.min(BOARD_PAGE_SIZE, page.hidden)} more ({page.hidden} hidden)
                            </button>
                          )}
                          {!prsLoading &&
                            !prsError &&
                            total === 0 && (
                              <div className="board-column-empty">
                                {query || repoFilter || kindFilter !== 'all' ? 'No matches' : 'None'}
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="board-body is-empty">
          <div className="chat-empty">
            <div className="chat-empty-mark" aria-hidden>
              <span className="chat-empty-cube" />
            </div>
            <h3>What should we orchestrate?</h3>
            <p>
              Chats that steer worktree agents across your registered workspaces. Slack DMs
              and @mentions land on the Global orchestrator. Connected tickets appear in
              Backlog, and open PRs appear in Review, once a workspace is registered.
            </p>
            <div className="chat-empty-action">
              <button type="button" className="primary" onClick={onNewGlobalChat}>
                New chat
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function IssueCard({
  issue,
  workspaces,
  pickedRepo,
  onPickRepo,
  starting,
  error,
  onStart,
  fallbackProvider,
}: {
  issue: BoardIssue;
  workspaces: Workspace[];
  pickedRepo: string;
  onPickRepo: (path: string) => void;
  starting: boolean;
  error?: string;
  onStart: () => void;
  fallbackProvider: string;
}) {
  const provider = issue.provider ?? fallbackProvider;
  const canStart = Boolean(pickedRepo) && !starting;
  return (
    <article className="board-card board-card-issue">
      <div className="board-card-top">
        <span className={`picker-logo tiny ${provider}`} title={issueSourceLabel(provider)} />
        <span className="board-card-id">{issue.identifier}</span>
      </div>
      <div className="board-card-title">{issue.title}</div>
      {(issue.cycle?.name || issue.assignee) && (
        <div className="thread-meta">
          {[issue.cycle?.name, issue.assignee].filter(Boolean).join(' · ')}
        </div>
      )}
      {issue.labels.length > 0 && (
        <div className="board-card-labels">
          {issue.labels.slice(0, 8).map((label) => (
            <span key={label} className="board-badge">{label}</span>
          ))}
          {issue.labels.length > 8 && (
            <span className="board-badge">+{issue.labels.length - 8}</span>
          )}
        </div>
      )}
      {issue.repoPath && (
        <div className="thread-meta">{workspaceName(issue.repoPath, workspaces)}</div>
      )}
      {issue.needsWorkspacePick && workspaces.length > 1 && (
        <label className="board-card-workspace">
          <span className="thread-meta">Workspace</span>
          <select
            value={pickedRepo}
            onChange={(e) => onPickRepo(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.path} value={w.path}>{w.name}</option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="board-card-error">{error}</div>}
      <div className="board-row-actions">
        <button type="button" disabled={!canStart} onClick={onStart}>
          {starting ? 'Starting…' : 'Start'}
        </button>
      </div>
    </article>
  );
}

function PrCard({
  pr,
  workspaces,
  starting,
  error,
  onStart,
}: {
  pr: BoardPr;
  workspaces: Workspace[];
  starting: boolean;
  error?: string;
  onStart: () => void;
}) {
  const canStart = Boolean(pr.repoPath) && !starting;
  return (
    <article className="board-card board-card-pr">
      <div className="board-card-top">
        <span className="picker-logo tiny github" title="GitHub" />
        <span className="board-card-id">#{pr.number}</span>
      </div>
      <div className="board-card-title">{pr.title}</div>
      <div className="thread-meta">
        {prAuthorLogin(pr) ? `${prAuthorLogin(pr)} · ` : ''}
        {pr.headRefName}
        {pr.repoPath ? ` · ${workspaceName(pr.repoPath, workspaces)}` : ''}
        {pr.isCrossRepository ? ' · fork' : ''}
      </div>
      {error && <div className="board-card-error">{error}</div>}
      <div className="board-row-actions">
        <button type="button" disabled={!canStart} onClick={onStart}>
          {starting ? 'Starting…' : 'Start'}
        </button>
        {pr.url ? (
          <button
            type="button"
            onClick={() => void window.sideboard.openExternal(pr.url)}
          >
            Open PR
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ThreadCard({
  thread: t,
  live,
  workspaces,
  onOpenThread,
  onRefresh,
}: {
  thread: Thread;
  live: string | undefined;
  workspaces: Workspace[];
  onOpenThread: (id: string) => void;
  onRefresh: () => void;
}) {
  const { text: previewText } = previewForThread(t, live);
  const preview = previewText ? compactPreview(previewText) : '';
  const repo = workspaceName(t.repoPath, workspaces);
  return (
    <article className="board-card board-card-thread">
      <div className="board-card-top">
        <span className={`dot ${t.status}`} title={t.status} />
        <div
          className="board-open"
          role="button"
          tabIndex={0}
          onClick={() => onOpenThread(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenThread(t.id);
            }
          }}
        >
          <div className="thread-title">{threadDisplayTitle(t)}</div>
          <div className="thread-meta">
            {t.agent} · {t.status}
            {t.queue.length ? ` · q${t.queue.length}` : ''}
            {t.sourceType === 'ticket' || t.sourceType === 'pr'
              ? ` · ${t.sourceType}:${t.sourceRef}`
              : t.sourceType === 'adopt'
                ? ' · adopt'
                : t.cowboy
                  ? ' · cowboy'
                  : t.sourceType === 'branch' && t.branchName
                    ? ` · ${t.branchName}`
                    : ''}
            {repo ? ` · ${repo}` : ''}
            {' · '}
            {relativeTime(t.updatedAt)}
          </div>
        </div>
      </div>
      {preview ? (
        <div className="board-preview board-preview-compact">{preview}</div>
      ) : null}
      <div className="board-row-actions">
        {(t.status === 'running' || t.status === 'queued') && (
          <button
            type="button"
            onClick={() => void window.sideboard.stopThread(t.id).then(onRefresh)}
          >
            Stop
          </button>
        )}
        <button type="button" onClick={() => onOpenThread(t.id)}>Open</button>
      </div>
    </article>
  );
}
