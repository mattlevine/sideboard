import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IssueInfo, OrchestratorRuntime, Thread, Workspace } from '@sideboard-ai/core';
import { CLOUD_ORCHESTRATOR_GOAL, threadDisplayTitle } from '../lib/global-workspace';
import {
  BOARD_COLUMN_DEFS,
  backlogIssues,
  boardIssueKey,
  classifyThreadColumn,
  dedupeBoardIssues,
  issueNeedsWorkspacePick,
  issueSourceLabel,
  pickDefaultRepoPath,
  type BoardColumnId,
  type BoardIssue,
} from '../lib/home-board';
import { FleetActivityBar } from './FleetActivityBar';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  threads: Thread[];
  archivedThreads?: Thread[];
  workspaces?: Workspace[];
  lastUsedRepoPath?: string;
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  onOpenThread: (id: string) => void;
  onNewGlobalChat: () => void;
  onRefresh: () => void;
  onStartIssue?: (issue: IssueInfo, repoPath: string) => Promise<void>;
  /** Left-edge open control when the left sidebar is closed. */
  leftSidebarToggle?: ReactNode;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
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
  onNewGlobalChat,
  onRefresh,
  onStartIssue,
  leftSidebarToggle,
}: Props) {
  const [issues, setIssues] = useState<BoardIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issueSource, setIssueSource] = useState<string>('github');
  const [issueRefresh, setIssueRefresh] = useState(0);
  const [doneOpen, setDoneOpen] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<Record<string, string>>({});
  const [pickedRepo, setPickedRepo] = useState<Record<string, string>>({});

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
      return;
    }

    setIssuesLoading(true);
    setIssuesError(null);

    void (async () => {
      try {
        const collected: BoardIssue[] = [];
        const first = await window.sideboard.listIssues(paths[0]!);
        if (cancelled) return;
        setIssueSource(first.source);

        if (first.source === 'linear') {
          const repoPath = paths[0] ?? '';
          for (const issue of first.issues) {
            collected.push({
              ...issue,
              repoPath,
              needsWorkspacePick: issueNeedsWorkspacePick(
                issue.provider ?? first.source,
                paths.length,
              ),
            });
          }
        } else {
          const settled = await Promise.allSettled(
            paths.map(async (path) => {
              const result =
                path === paths[0]
                  ? first
                  : await window.sideboard.listIssues(path);
              return result.issues.map((issue) => ({
                ...issue,
                repoPath: path,
                needsWorkspacePick: issueNeedsWorkspacePick(
                  issue.provider ?? result.source,
                  1,
                ),
              }));
            }),
          );
          if (cancelled) return;
          for (const item of settled) {
            if (item.status === 'fulfilled') collected.push(...item.value);
          }
          const rejected = settled.find((s) => s.status === 'rejected');
          if (rejected && rejected.status === 'rejected' && collected.length === 0) {
            throw rejected.reason;
          }
        }

        if (!cancelled) setIssues(dedupeBoardIssues(collected));
      } catch (err) {
        if (cancelled) return;
        setIssuesError(err instanceof Error ? err.message : String(err));
        setIssues([]);
      } finally {
        if (!cancelled) setIssuesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceKey, issueRefresh]);

  const defaultRepo = pickDefaultRepoPath(workspaces, lastUsedRepoPath);

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
    () => [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );
  const doneThreads = useMemo(
    () => [...archivedThreads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [archivedThreads],
  );

  const backlog = useMemo(
    () => backlogIssues(boardIssues, liveThreads),
    [boardIssues, liveThreads],
  );

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

  const hasBoardContent =
    issuesLoading ||
    Boolean(issuesError) ||
    backlog.length > 0 ||
    liveThreads.length > 0 ||
    doneThreads.length > 0;

  function handleRefresh() {
    setIssueRefresh((n) => n + 1);
    onRefresh();
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
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${liveThreads.length} thread${liveThreads.length === 1 ? '' : 's'}`
            : '…'}
        </span>
        <div className="actions">
          <button type="button" onClick={handleRefresh}>Refresh</button>
          <button type="button" onClick={onNewGlobalChat}>New chat</button>
        </div>
      </div>

      {hasBoardContent ? (
        <>
          <FleetActivityBar runtime={runtime} compact />
          <p className="board-lede">
            Tickets from the connected tracker land in Backlog. Start opens a worktree;
            the card then follows agent and PR status. New chat still steers the Global
            orchestrator.
          </p>
          <div className="board-body board-kanban-wrap">
            <div className="board-kanban">
              {BOARD_COLUMN_DEFS.map((col) => {
                if (col.id === 'backlog') {
                  return (
                    <section key={col.id} className="board-column">
                      <header className="board-column-header">
                        <h3>{col.title}</h3>
                        <span className="thread-meta">{backlog.length}</span>
                      </header>
                      <div className="board-column-cards">
                        {issuesLoading && (
                          <div className="board-column-empty">Loading tickets…</div>
                        )}
                        {issuesError && !issuesLoading && (
                          <div className="board-column-empty">{issuesError}</div>
                        )}
                        {!issuesLoading && !issuesError && backlog.length === 0 && (
                          <div className="board-column-empty">
                            No {issueSourceLabel(issueSource)} tickets
                          </div>
                        )}
                        {backlog.map((issue) => {
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
                      </div>
                    </section>
                  );
                }

                const cards = byColumn[col.id];
                const collapsed = col.id === 'done' && !doneOpen;
                return (
                  <section
                    key={col.id}
                    className={`board-column${col.id === 'done' ? ' is-done' : ''}`}
                  >
                    <header className="board-column-header">
                      <h3>{col.title}</h3>
                      <span className="thread-meta">{cards.length}</span>
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
                          {cards.length === 0 ? 'None archived' : 'Collapsed'}
                        </div>
                      ) : cards.length === 0 ? (
                        <div className="board-column-empty">None</div>
                      ) : (
                        cards.map((t) => (
                          <ThreadCard
                            key={t.id}
                            thread={t}
                            live={liveByThread[t.id]}
                            onOpenThread={onOpenThread}
                            onRefresh={onRefresh}
                          />
                        ))
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
              Backlog once a workspace is registered.
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
      {issue.labels.length > 0 && (
        <div className="board-card-labels">
          {issue.labels.slice(0, 4).map((label) => (
            <span key={label} className="board-badge">{label}</span>
          ))}
        </div>
      )}
      {issue.provider === 'github' && issue.repoPath && (
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

function ThreadCard({
  thread: t,
  live,
  onOpenThread,
  onRefresh,
}: {
  thread: Thread;
  live: string | undefined;
  onOpenThread: (id: string) => void;
  onRefresh: () => void;
}) {
  const { text: previewText, markdown: previewIsMarkdown } = previewForThread(t, live);
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
            {' · '}
            {relativeTime(t.updatedAt)}
          </div>
        </div>
      </div>
      {previewText ? (
        <div className="board-preview">
          {previewIsMarkdown ? (
            <MarkdownMessage
              text={previewText}
              className="md md-compact"
              onThreadLinkClick={onOpenThread}
            />
          ) : (
            previewText
          )}
        </div>
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
