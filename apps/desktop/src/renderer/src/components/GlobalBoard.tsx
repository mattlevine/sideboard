import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OrchestratorRuntime, Thread, Workspace } from '@sideboard-ai/core';
import {
  normalizeWorktreePath,
  worktreeDisplayLabelForGroup,
} from '@sideboard/worktree-labels';
import { CLOUD_ORCHESTRATOR_GOAL, threadDisplayTitle } from '../lib/global-workspace';
import { archiveWorktreeMessage } from '../lib/close-chat-tab';
import {
  BOARD_COLUMN_DEFS,
  BOARD_PAGE_SIZE,
  classifyWorktreeColumn,
  compactPreview,
  groupHomeBoardWorktrees,
  isHomeBoardThread,
  visiblePage,
  worktreeBoardStatus,
  type BoardColumnId,
} from '../lib/home-board';
import {
  isWorktreeUnread,
  latestAgentResponseAt,
  unreadWorktreeKey,
} from '../lib/unread-worktrees';
import { FleetActivityBar } from './FleetActivityBar';
import { ThreadStatusIcon } from './ThreadStatusIcon';

interface Props {
  threads: Thread[];
  workspaces?: Workspace[];
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  /** Last-opened chat — wrapper click reopens that tab when it belongs to the card. */
  selectedId?: string | null;
  onOpenThread: (id: string) => void;
  onAddToBoard: () => void;
  onNewOrchestration: () => void;
  onRefresh: () => void;
  onArchive: (
    ids: string[],
    meta?: { title?: string; removesWorktree?: boolean },
  ) => void | Promise<void>;
  archivingIds?: Set<string>;
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
  workspaces = [],
  runtime,
  liveByThread,
  selectedId = null,
  onOpenThread,
  onAddToBoard,
  onNewOrchestration,
  onRefresh,
  onArchive,
  archivingIds = new Set(),
  leftSidebarToggle,
}: Props) {
  const [shownByCol, setShownByCol] = useState<Partial<Record<BoardColumnId, number>>>({});
  const [archiveConfirm, setArchiveConfirm] = useState<{
    threadIds: string[];
    title: string;
    chatCount: number;
    removesWorktree: boolean;
    cowboy: boolean;
  } | null>(null);

  const worktrees = useMemo(
    () =>
      groupHomeBoardWorktrees(
        threads.filter((t) => t.status !== 'archived' && isHomeBoardThread(t)),
      ),
    [threads],
  );

  const byColumn = useMemo(() => {
    const map: Record<'new' | 'draft' | 'review' | 'done', Thread[][]> = {
      new: [],
      draft: [],
      review: [],
      done: [],
    };
    for (const group of worktrees) {
      const col = classifyWorktreeColumn(group);
      if (col === 'new' || col === 'draft' || col === 'review' || col === 'done') {
        map[col].push(group);
      }
    }
    return map;
  }, [worktrees]);

  const worktreeCount = worktrees.length;
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

  function requestArchive(group: Thread[]) {
    const primary = group[0];
    if (!primary) return;
    setArchiveConfirm({
      threadIds: group.map((t) => t.id),
      title: worktreeDisplayLabelForGroup(group),
      chatCount: group.length,
      removesWorktree: !primary.cowboy,
      cowboy: Boolean(primary.cowboy),
    });
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
            onClick={onNewOrchestration}
            title="Start a new orchestration chat"
          >
            New orchestration
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
                return (
                  <section
                    key={col.id}
                    className={`board-column${col.id === 'done' ? ' is-done' : ''}`}
                  >
                    <header className="board-column-header">
                      <h3>{col.title}</h3>
                      <span className="thread-meta">{countLabel(page.visible.length, total)}</span>
                    </header>
                    <div className="board-column-cards">
                      {page.visible.map((group) => {
                        const primary = group[0]!;
                        return (
                          <WorktreeCard
                            key={normalizeWorktreePath(primary.worktreePath)}
                            group={group}
                            liveByThread={liveByThread}
                            workspaces={workspaces}
                            selectedId={selectedId}
                            archiving={group.some((t) => archivingIds.has(t.id))}
                            canArchive={col.id === 'done'}
                            onOpenThread={onOpenThread}
                            onRefresh={onRefresh}
                            onArchive={() => requestArchive(group)}
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
                      {total === 0 && (
                        <div className="board-column-empty">
                          None
                        </div>
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
            <p>Add a ticket, PR, or branch to create a worktree. Home shows one card per checkout (chats nested inside): New → Draft → Review → Merged. Archive sends the worktree to Settings → History.</p>
            <div className="chat-empty-action">
              <button type="button" className="primary" onClick={onAddToBoard}>
                Add to Board
              </button>
            </div>
          </div>
        </div>
      )}
      {archiveConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setArchiveConfirm(null)}
        >
          <div
            className="modal create-modal merge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-board-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="create-modal-content">
              <h3 id="archive-board-title" className="merge-modal-title">
                {archiveConfirm.cowboy && !archiveConfirm.removesWorktree
                  ? 'Archive cowboy worktree?'
                  : 'Archive worktree?'}
              </h3>
              <p className="confirm-dialog-message">
                {archiveWorktreeMessage(archiveConfirm.title, archiveConfirm.chatCount, {
                  removesWorktree: archiveConfirm.removesWorktree,
                  cowboy: archiveConfirm.cowboy,
                })}
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button type="button" onClick={() => setArchiveConfirm(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const { threadIds, title, removesWorktree } = archiveConfirm;
                    setArchiveConfirm(null);
                    void Promise.resolve(
                      onArchive(threadIds, { title, removesWorktree }),
                    ).catch((err: unknown) => {
                      window.alert(err instanceof Error ? err.message : String(err));
                    });
                  }}
                >
                  Archive worktree
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function worktreeSourceLabel(t: Thread): string | null {
  if (t.sourceType === 'ticket' || t.sourceType === 'pr') {
    return `${t.sourceType}:${t.sourceRef}`;
  }
  if (t.sourceType === 'adopt') return 'adopt';
  if (t.cowboy) return 'cowboy';
  if (t.sourceType === 'branch' && t.branchName) return t.branchName;
  return null;
}

function WorktreeCard({
  group,
  liveByThread,
  workspaces,
  selectedId,
  archiving,
  canArchive,
  onOpenThread,
  onRefresh,
  onArchive,
}: {
  group: Thread[];
  liveByThread: Record<string, string>;
  workspaces: Workspace[];
  selectedId: string | null;
  archiving: boolean;
  canArchive: boolean;
  onOpenThread: (id: string) => void;
  onRefresh: () => void;
  onArchive: () => void;
}) {
  const newest = group[0]!;
  const primary = group.find((t) => t.id === selectedId) ?? newest;
  const status = worktreeBoardStatus(group);
  const repo = workspaceName(newest.repoPath, workspaces);
  const label = worktreeDisplayLabelForGroup(group);
  const unread = isWorktreeUnread(
    unreadWorktreeKey(primary),
    latestAgentResponseAt(group),
    { active: false },
  );
  const [stat, setStat] = useState<{
    additions: number;
    deletions: number;
    dirty: boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const gen = ++fetchGen.current;
      try {
        const diff = await window.sideboard.getDiff(primary.id, {
          scope: 'uncommitted',
          includePatches: false,
        });
        if (cancelled || gen !== fetchGen.current) return;
        const s = diff.scopeStats?.uncommitted;
        setStat({
          additions: s?.additions ?? 0,
          deletions: s?.deletions ?? 0,
          dirty: Boolean(diff.dirty) || (s != null && (s.additions > 0 || s.deletions > 0)),
        });
        setLoaded(true);
      } catch {
        if (cancelled || gen !== fetchGen.current) return;
        setStat({ additions: 0, deletions: 0, dirty: false });
        setLoaded(true);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [primary.id, primary.status, primary.worktreePath]);

  const dirty = loaded && Boolean(stat?.dirty);

  function openWorktree() {
    if (!archiving) onOpenThread(primary.id);
  }

  return (
    <article
      className={`board-card board-card-worktree${archiving ? ' is-archiving' : ''}`}
      aria-busy={archiving}
      onClick={openWorktree}
    >
      <div className="board-card-top">
        {archiving ? (
          <span className="thread-archive-spinner" aria-hidden />
        ) : (
          <ThreadStatusIcon
            status={status}
            dirty={dirty}
            dirtyLoaded={loaded}
            additions={stat?.additions ?? 0}
            deletions={stat?.deletions ?? 0}
            unread={unread}
          />
        )}
        <div
          className="board-open"
          role="button"
          tabIndex={archiving ? -1 : 0}
          aria-label={`Open ${label}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openWorktree();
            }
          }}
        >
          <div className="thread-title">{label}</div>
          <div className="thread-meta">
            {archiving
              ? 'Archiving…'
              : [
                  group.length > 1 ? `${group.length} chats` : '1 chat',
                  worktreeSourceLabel(newest),
                  repo || null,
                  relativeTime(newest.updatedAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </div>
        </div>
      </div>
      {canArchive && (
        <div
          className="board-card board-card-archive"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="board-archive-worktree"
            disabled={archiving}
            title="Archive this worktree — all chats move to Settings → History"
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            {archiving ? 'Archiving…' : 'Archive worktree'}
          </button>
        </div>
      )}
      <div className={`board-card-chats${group.length > 3 ? ' is-scrollable' : ''}`}>
        {group.map((chat) => (
          <ChatCard
            key={chat.id}
            thread={chat}
            live={liveByThread[chat.id]}
            archiving={archiving}
            onOpenThread={onOpenThread}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </article>
  );
}

function ChatCard({
  thread: t,
  live,
  archiving,
  onOpenThread,
  onRefresh,
}: {
  thread: Thread;
  live: string | undefined;
  archiving: boolean;
  onOpenThread: (id: string) => void;
  onRefresh: () => void;
}) {
  const { text: previewText } = previewForThread(t, live);
  const preview = previewText ? compactPreview(previewText) : '';
  const canStop = t.status === 'running' || t.status === 'queued';
  return (
    <div
      className="board-card board-card-chat"
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        if (!archiving) onOpenThread(t.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          if (!archiving) onOpenThread(t.id);
        }
      }}
    >
      <div className="board-card-top">
        <span className={`dot ${t.status}`} title={t.status} />
        <div className="board-open">
          <div className="thread-title">{threadDisplayTitle(t)}</div>
          <div className="thread-meta">
            {[
              t.agent,
              t.status,
              t.queue.length ? `q${t.queue.length}` : null,
              relativeTime(t.updatedAt),
            ]
              .filter(Boolean)
              .join(' · ')}
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
    </div>
  );
}
