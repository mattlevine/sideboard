import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IssueInfo, OrchestratorRuntime, PrInfo, Thread, Workspace } from '@sideboard-ai/core';
import { CLOUD_ORCHESTRATOR_GOAL, threadDisplayTitle } from '../lib/global-workspace';
import {
  BOARD_COLUMN_DEFS,
  BOARD_PAGE_SIZE,
  HOME_BOARD_CACHE_TTL_MS,
  backlogPins,
  boardPinKey,
  classifyThreadColumn,
  compactPreview,
  haystackMatches,
  inWorkspace,
  isHomeBoardThread,
  issueSourceLabel,
  pickDefaultRepoPath,
  pinSearchText,
  threadSearchText,
  tokenizeQuery,
  visiblePage,
  type BoardColumnId,
  type BoardKindFilter,
  type BoardPin,
} from '../lib/home-board';
import { AddToBoardModal } from './AddToBoardModal';
import { FleetActivityBar } from './FleetActivityBar';

interface Props {
  threads: Thread[];
  archivedThreads?: Thread[];
  workspaces?: Workspace[];
  lastUsedRepoPath?: string;
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  onOpenThread: (id: string) => void;
  onRefresh: () => void;
  onStartIssue?: (issue: IssueInfo, repoPath: string) => Promise<void>;
  onStartPr?: (pr: PrInfo, repoPath: string) => Promise<void>;
  onStartBranch?: (ref: string, repoPath: string, title?: string) => Promise<void>;
  onOpenAccount?: () => void;
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
  onRefresh,
  onStartIssue,
  onStartPr,
  onStartBranch,
  onOpenAccount,
  leftSidebarToggle,
}: Props) {
  const [pins, setPins] = useState<BoardPin[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issueSource, setIssueSource] = useState<string>('github');
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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
        setPins(loaded.pins);
        setIssuesError(loaded.issueErrors[0] ?? null);
        setPrsError(loaded.prErrors[0] ?? null);
        setFetchedAt(loaded.fetchedAt);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setIssuesError(message);
        setPrsError(message);
        setPins([]);
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
    () => backlogPins(pins, liveThreads),
    [pins, liveThreads],
  );

  const queryTokens = useMemo(() => tokenizeQuery(query), [query]);

  useEffect(() => {
    setShownByCol({});
  }, [query, repoFilter, kindFilter]);

  const filteredBacklog = useMemo(() => {
    if (kindFilter === 'threads') return [];
    return backlog.filter((pin) => {
      if (kindFilter === 'tickets' && pin.kind !== 'ticket') return false;
      if (kindFilter === 'prs' && pin.kind !== 'pr') return false;
      if (kindFilter === 'branches' && pin.kind !== 'branch') return false;
      return (
        inWorkspace(pin.repoPath, repoFilter) &&
        haystackMatches(pinSearchText(pin, workspaceName(pin.repoPath, workspaces)), queryTokens)
      );
    });
  }, [backlog, kindFilter, repoFilter, queryTokens, workspaces]);

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
    if (kindFilter === 'tickets' || kindFilter === 'prs' || kindFilter === 'branches') return map;
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
    pins.length > 0 ||
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

  async function handleStartPin(item: BoardPin) {
    const key = boardPinKey(item);
    const repo = pickedRepo[key] || item.repoPath || defaultRepo;
    if (!repo) {
      setStartError((prev) => ({ ...prev, [key]: 'Add a workspace first' }));
      return;
    }
    setStartingId(key);
    setStartError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      if (item.kind === 'ticket') {
        if (!onStartIssue) return;
        await onStartIssue(
          {
            id: item.ref,
            identifier: item.ref,
            title: item.title,
            url: item.url ?? '',
            labels: item.labels ?? [],
            provider: item.provider as IssueInfo['provider'],
            assignee: item.assignee,
          },
          repo,
        );
      } else if (item.kind === 'pr') {
        if (!onStartPr) return;
        const number = Number(item.ref.replace(/^#/, ''));
        await onStartPr(
          {
            number: Number.isFinite(number) ? number : 0,
            title: item.title,
            headRefName: item.headRefName ?? item.ref,
            url: item.url ?? '',
            isCrossRepository: false,
          },
          repo,
        );
      } else if (onStartBranch) {
        await onStartBranch(item.ref, repo, item.title);
      }
    } catch (err) {
      setStartError((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStartingId((id) => (id === key ? null : id));
    }
  }

  async function handleRemovePin(id: string) {
    await window.sideboard.removeBoardItem(id);
    setPins((prev) => prev.filter((p) => p.id !== id));
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
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${filteredBacklog.length} ready · ${filteredThreadCount} thread${filteredThreadCount === 1 ? '' : 's'}`
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
            onClick={() => setAddOpen(true)}
            title="Pull a ticket, PR, or branch onto the board"
          >
            Add to Board
          </button>
        </div>
      </div>

      {hasBoardContent ? (
        <>
          <FleetActivityBar runtime={runtime} compact />
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
                { id: 'branches' as const, label: 'Branches' },
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
                        {!issuesLoading && !issuesError && filteredBacklog.length === 0 && (
                          <div className="board-column-empty">
                            {query || repoFilter || kindFilter !== 'all'
                              ? 'No matches'
                              : 'Add a ticket, PR, or branch'}
                          </div>
                        )}
                        {page.visible.map((item) => {
                          const key = boardPinKey(item);
                          return (
                            <PinCard
                              key={key}
                              pin={item}
                              workspaces={workspaces}
                              pickedRepo={pickedRepo[key] || item.repoPath || defaultRepo}
                              onPickRepo={(path) =>
                                setPickedRepo((prev) => ({ ...prev, [key]: path }))
                              }
                              starting={startingId === key}
                              error={startError[key]}
                              onStart={() => void handleStartPin(item)}
                              onRemove={() => void handleRemovePin(item.id)}
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
                const total = cards.length;
                const page = visiblePage(cards, shownFor(col.id));
                const collapsed = col.id === 'done' && !doneOpen;
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
                          {page.visible.map((thread) => (
                            <ThreadCard
                              key={thread.id}
                              thread={thread}
                              live={liveByThread[thread.id]}
                              workspaces={workspaces}
                              onOpenThread={onOpenThread}
                              onRefresh={onRefresh}
                            />
                          ))}
                          {page.hidden > 0 && (
                            <button
                              type="button"
                              className="board-column-more"
                              onClick={() => showMore(col.id)}
                            >
                              Show {Math.min(BOARD_PAGE_SIZE, page.hidden)} more ({page.hidden} hidden)
                            </button>
                          )}
                          {total === 0 && (
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
            <h3>Pull work onto the board</h3>
            <p>Add a ticket, PR, or branch, then Start a worktree from the card.</p>
            <div className="chat-empty-action">
              <button type="button" className="primary" onClick={() => setAddOpen(true)}>
                Add to Board
              </button>
            </div>
          </div>
        </div>
      )}
      {addOpen && (
        <AddToBoardModal
          workspaces={workspaces}
          lastUsedRepoPath={lastUsedRepoPath}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            setRemoteReq((prev) => ({ n: prev.n + 1, refresh: false }));
          }}
          onOpenAccount={onOpenAccount}
        />
      )}
    </section>
  );
}

function PinCard({
  pin,
  workspaces,
  pickedRepo,
  onPickRepo,
  starting,
  error,
  onStart,
  onRemove,
  fallbackProvider,
}: {
  pin: BoardPin;
  workspaces: Workspace[];
  pickedRepo: string;
  onPickRepo: (path: string) => void;
  starting: boolean;
  error?: string;
  onStart: () => void;
  onRemove: () => void;
  fallbackProvider: string;
}) {
  const provider = pin.provider ?? (pin.kind === 'pr' ? 'github' : fallbackProvider);
  const canStart = Boolean(pickedRepo) && !starting;
  const idLabel =
    pin.kind === 'pr'
      ? `#${pin.ref.replace(/^#/, '')}`
      : pin.kind === 'ticket'
        ? pin.ref
        : pin.ref === 'default'
          ? 'default'
          : pin.ref;
  return (
    <article className={`board-card board-card-${pin.kind}`}>
      <div className="board-card-top">
        {pin.kind === 'branch' ? (
          <span className="board-card-id" aria-hidden>⎇</span>
        ) : (
          <span className={`picker-logo tiny ${provider}`} title={issueSourceLabel(provider)} />
        )}
        <span className="board-card-id">{idLabel}</span>
        {pin.remoteState && pin.remoteState !== 'open' ? (
          <span className="thread-meta">{pin.remoteState}</span>
        ) : null}
      </div>
      <div className="board-card-title">{pin.title}</div>
      {(pin.cycle || pin.assignee || pin.headRefName || pin.author) && (
        <div className="thread-meta">
          {[pin.cycle, pin.assignee, pin.author, pin.headRefName].filter(Boolean).join(' · ')}
        </div>
      )}
      {(pin.labels ?? []).length > 0 && (
        <div className="board-card-labels">
          {(pin.labels ?? []).slice(0, 8).map((label) => (
            <span key={label} className="board-badge">{label}</span>
          ))}
        </div>
      )}
      {pin.repoPath && (
        <div className="thread-meta">{workspaceName(pin.repoPath, workspaces)}</div>
      )}
      {pin.needsWorkspacePick && workspaces.length > 1 && (
        <label className="board-card-workspace">
          <span className="thread-meta">Workspace</span>
          <select value={pickedRepo} onChange={(e) => onPickRepo(e.target.value)}>
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
        {pin.url ? (
          <button type="button" onClick={() => void window.sideboard.openExternal(pin.url!)}>
            Open
          </button>
        ) : null}
        <button type="button" onClick={onRemove}>Remove</button>
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
