import { useMemo, useState, type ReactNode } from 'react';
import type { OrchestratorRuntime, Thread, Workspace } from '@sideboard-ai/core';
import { CLOUD_ORCHESTRATOR_GOAL, threadDisplayTitle } from '../lib/global-workspace';
import {
  BOARD_COLUMN_DEFS,
  BOARD_PAGE_SIZE,
  classifyThreadColumn,
  compactPreview,
  isHomeBoardThread,
  visiblePage,
  type BoardColumnId,
} from '../lib/home-board';
import { FleetActivityBar } from './FleetActivityBar';

interface Props {
  threads: Thread[];
  archivedThreads?: Thread[];
  workspaces?: Workspace[];
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  onOpenThread: (id: string) => void;
  onAddToBoard: () => void;
  onRefresh: () => void;
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
  runtime,
  liveByThread,
  onOpenThread,
  onAddToBoard,
  onRefresh,
  leftSidebarToggle,
}: Props) {
  const [doneOpen, setDoneOpen] = useState(false);
  const [shownByCol, setShownByCol] = useState<Partial<Record<BoardColumnId, number>>>({});

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

  const byColumn = useMemo(() => {
    const map: Record<'needs_you' | 'review' | 'done', Thread[]> = {
      needs_you: [],
      review: [],
      done: [],
    };
    for (const t of liveThreads) {
      const col = classifyThreadColumn(t);
      if (col === 'needs_you' || col === 'review') map[col].push(t);
    }
    map.done = doneThreads;
    return map;
  }, [liveThreads, doneThreads]);

  const worktreeCount = liveThreads.length + doneThreads.length;
  const hasBoardContent = worktreeCount > 0;

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
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${worktreeCount} worktree${worktreeCount === 1 ? '' : 's'}`
            : '…'}
        </span>
        <div className="actions">
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
          <button
            type="button"
            onClick={onAddToBoard}
            title="Create a worktree from a ticket, PR, or branch"
          >
            Add to Board
          </button>
        </div>
      </div>

      {hasBoardContent ? (
        <>
          <FleetActivityBar runtime={runtime} compact />
          <div className="board-body board-kanban-wrap">
            <div className="board-kanban">
              {BOARD_COLUMN_DEFS.map((col) => {
                const cards = byColumn[col.id as keyof typeof byColumn] ?? [];
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
                              None
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
            <h3>No worktrees yet</h3>
            <p>Add a ticket, PR, or branch to create a worktree. Home shows where each one is on the path to done.</p>
            <div className="chat-empty-action">
              <button type="button" className="primary" onClick={onAddToBoard}>
                Add to Board
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
  const canStop = t.status === 'running' || t.status === 'queued';
  return (
    <article
      className="board-card board-card-thread"
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
      <div className="board-card-top">
        <span className={`dot ${t.status}`} title={t.status} />
        <div className="board-open">
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
      {canStop && (
        <div className="board-row-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void window.sideboard.stopThread(t.id).then(onRefresh);
            }}
          >
            Stop
          </button>
        </div>
      )}
    </article>
  );
}
