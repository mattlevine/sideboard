import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  normalizeWorktreePath,
  threadDisplayLabel,
  worktreeDisplayLabelForGroup,
} from '@sideboard/worktree-labels';
import type { Thread } from '@sideboard-ai/core';
import {
  GLOBAL_WORKSPACE_ID,
  isCloudCoordinatorThread,
  threadDisplayTitle,
} from '../lib/global-workspace';
import { closeChatTabMessage } from '../lib/close-chat-tab';
import {
  isWorktreeUnread,
  latestAgentResponseAt,
  unreadWorktreeKey,
} from '../lib/unread-worktrees';
import { BrandMark } from './BrandMark';
import { SidebarToggle } from './SidebarToggle';

interface Props {
  threads: Thread[];
  selectedId: string | null;
  view: 'board' | 'thread';
  multiSelected: Set<string>;
  repoPath: string;
  /** Registered workspaces (show even with zero threads). */
  workspaces?: Array<{ path: string; name: string }>;
  onShowBoard: () => void;
  onSelect: (id: string, multi: boolean) => void;
  onNew: (repoPath?: string, mode?: 'quick' | 'orchestration') => void;
  onPickRepo: () => void;
  onArchive?: (
    threadIds: string[],
    meta: { title: string; removesWorktree: boolean },
  ) => void | Promise<void>;
  /** Thread id currently being archived (shows progress on its worktree row). */
  archivingId?: string | null;
  /** Unregister a project workspace (caller archives threads as needed). */
  onRemoveWorkspace?: (repoPath: string) => void | Promise<void>;
  onToggleSidebar: () => void;
  onOpenSettings?: () => void;
}

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

/** Paths that should never appear as a project row (e.g. packaged-app cwd `/`). */
function isProjectPath(path: string): boolean {
  if (!path || path === GLOBAL_WORKSPACE_ID) return false;
  if (path === '/' || path === '.') return false;
  return true;
}

function groupByWorktree(threads: Thread[]): Thread[][] {
  const map = new Map<string, Thread[]>();
  for (const t of threads) {
    const key = normalizeWorktreePath(t.worktreePath);
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return [...map.values()].map((list) =>
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

type WorktreeDiffStat = { additions: number; deletions: number };

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function prNumberFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/pull\/(\d+)/);
  return m?.[1] ?? null;
}

function worktreeSlug(thread: Thread): string {
  const base = thread.worktreePath.replace(/\/$/, '').split('/').pop();
  return base || thread.branchName.replace(/^thread\//, '') || 'workspace';
}

function previewSnippet(thread: Thread): string {
  if (thread.lastError?.trim()) return thread.lastError.trim();
  const last = [...thread.messages].reverse().find(
    (m) => m.role === 'agent' || m.role === 'user',
  );
  if (last?.text?.trim()) {
    const t = last.text.trim().replace(/\s+/g, ' ');
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }
  if (thread.branchName?.trim()) return thread.branchName;
  return '';
}

function WorktreeArchiveCard({
  open,
  anchorRef,
  thread,
  label,
  onArchive,
  onKeepOpen,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  thread: Thread;
  label: string;
  onArchive: () => void;
  onKeepOpen: (v: boolean) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const slug = worktreeSlug(thread);
  const prNum = prNumberFromUrl(thread.prUrl);
  const preview = previewSnippet(thread);
  const ok =
    thread.status === 'idle' ||
    thread.status === 'stopped' ||
    thread.status === 'archived';

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 280;
    let left = rect.right + 10;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, rect.left - width - 10);
    }
    let top = rect.top - 8;
    if (top + 180 > window.innerHeight - 12) {
      top = Math.max(12, window.innerHeight - 192);
    }
    setPos({ top, left });
  }, [open, anchorRef, thread.id]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      className="worktree-hover-card"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Archive ${label}`}
      onMouseEnter={() => onKeepOpen(true)}
      onMouseLeave={() => onKeepOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="worktree-hover-card-top">
        <span className="worktree-hover-card-slug">{slug}</span>
        <span
          className={`worktree-hover-card-status${ok ? ' ok' : ''}`}
          title={thread.status}
          aria-label={thread.status}
        >
          {ok ? '✓' : '●'}
        </span>
      </div>
      <div className="worktree-hover-card-title" title={label}>
        {label}
      </div>
      {preview ? (
        <p className="worktree-hover-card-preview">{preview}</p>
      ) : null}
      <div className="worktree-hover-card-footer">
        <button
          type="button"
          className="worktree-hover-card-btn"
          onClick={onArchive}
        >
          <span aria-hidden>▤</span>
          Archive
        </button>
        <div className="worktree-hover-card-meta">
          {thread.prUrl && prNum ? (
            <button
              type="button"
              className="worktree-hover-card-pr"
              title={thread.prUrl}
              onClick={() => void window.sideboard.openExternal(thread.prUrl!)}
            >
              <span aria-hidden>⎇</span>
              #{prNum} ↗
            </button>
          ) : thread.branchName ? (
            <span className="worktree-hover-card-branch" title={thread.branchName}>
              ⎇ {thread.branchName.replace(/^thread\//, '')}
            </span>
          ) : null}
          <span className="worktree-hover-card-age">
            {relativeTime(thread.updatedAt)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function WorktreeEditCard({
  open,
  anchorRef,
  thread,
  label,
  dirty,
  loaded,
  additions,
  deletions,
  onOpen,
  onKeepOpen,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  thread: Thread;
  label: string;
  dirty: boolean;
  loaded: boolean;
  additions: number;
  deletions: number;
  onOpen: () => void;
  onKeepOpen: (v: boolean) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const slug = worktreeSlug(thread);
  const prNum = prNumberFromUrl(thread.prUrl);
  const preview = previewSnippet(thread);
  const ok =
    thread.status === 'idle' ||
    thread.status === 'stopped' ||
    thread.status === 'archived';

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = 280;
      let left = rect.right + 10;
      if (left + width > window.innerWidth - 12) {
        left = Math.max(12, rect.left - width - 10);
      }
      let top = rect.top - 8;
      if (top + 200 > window.innerHeight - 12) {
        top = Math.max(12, window.innerHeight - 212);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, thread.id]);

  async function createPr() {
    if (prBusy) return;
    setPrBusy(true);
    try {
      await window.sideboard.sendToThread(
        thread.id,
        'Commit, push, and open a draft PR.',
      );
      onKeepOpen(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPrBusy(false);
    }
  }

  if (!open || !pos) return null;

  const gitLabel = !loaded
    ? '…'
    : dirty
      ? `+${additions} −${deletions}`
      : 'clean';

  return createPortal(
    <div
      className="worktree-hover-card"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Open ${label}`}
      onMouseEnter={() => onKeepOpen(true)}
      onMouseLeave={() => onKeepOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="worktree-hover-card-top">
        <span className="worktree-hover-card-slug">{slug}</span>
        <span
          className={`worktree-hover-card-git${dirty ? ' is-dirty' : ''}${loaded ? '' : ' is-loading'}`}
          title={
            dirty
              ? `Uncommitted +${additions} −${deletions}`
              : loaded
                ? 'Working tree clean'
                : 'Loading git status…'
          }
          aria-label={
            dirty
              ? `Uncommitted +${additions} −${deletions}`
              : loaded
                ? 'Working tree clean'
                : 'Loading git status'
          }
        >
          {dirty && loaded ? (
            <>
              <span className="add">+{additions}</span>
              <span className="del">−{deletions}</span>
            </>
          ) : (
            gitLabel
          )}
        </span>
        <span
          className={`worktree-hover-card-status${ok ? ' ok' : ''}${dirty ? ' dirty' : ''}`}
          title={thread.status}
          aria-label={thread.status}
        >
          {ok && !dirty ? '✓' : '●'}
        </span>
      </div>
      <div className="worktree-hover-card-title" title={label}>
        {label}
      </div>
      {preview ? (
        <p className="worktree-hover-card-preview">{preview}</p>
      ) : null}
      <div className="worktree-hover-card-footer">
        {thread.prUrl && prNum ? (
          <button
            type="button"
            className="worktree-hover-card-btn"
            title={thread.prUrl}
            onClick={() => void window.sideboard.openExternal(thread.prUrl!)}
          >
            <span aria-hidden>⎇</span>
            #{prNum} ↗
          </button>
        ) : (
          <button
            type="button"
            className="worktree-hover-card-btn"
            disabled={prBusy}
            onClick={() => void createPr()}
          >
            <span aria-hidden>⎇</span>
            {prBusy ? 'Creating…' : 'Create PR'}
          </button>
        )}
        <div className="worktree-hover-card-meta">
          <button
            type="button"
            className="worktree-hover-card-open"
            onClick={onOpen}
          >
            Open
          </button>
          <span className="worktree-hover-card-age">
            {relativeTime(thread.updatedAt)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function WorktreeSidebarRow({
  primary,
  group,
  worktreeLabel,
  active,
  selected,
  archiving,
  unread,
  onSelect,
  showArchive,
  onRequestArchive,
}: {
  primary: Thread;
  group: Thread[];
  worktreeLabel: string;
  active: boolean;
  selected: boolean;
  archiving: boolean;
  unread: boolean;
  onSelect: (id: string, multi: boolean) => void;
  /** When true, show the archive control (parent handles confirm + teardown). */
  showArchive?: boolean;
  onRequestArchive: (chats: Thread[]) => void;
}) {
  const [rowHover, setRowHover] = useState(false);
  const [pencilHover, setPencilHover] = useState(false);
  const [stat, setStat] = useState<WorktreeDiffStat | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [archiveHover, setArchiveHover] = useState(false);
  const archiveBtnRef = useRef<HTMLButtonElement>(null);
  const pencilBtnRef = useRef<HTMLButtonElement>(null);
  const archiveCloseTimer = useRef<number | null>(null);
  const pencilCloseTimer = useRef<number | null>(null);
  const fetchGen = useRef(0);
  const wantFetch = rowHover || pencilHover || archiveHover;

  function clearTimer(ref: { current: number | null }) {
    if (ref.current != null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }

  function setArchiveCardOpen(next: boolean) {
    clearTimer(archiveCloseTimer);
    if (next) {
      clearTimer(pencilCloseTimer);
      setPencilHover(false);
      setArchiveHover(true);
      return;
    }
    archiveCloseTimer.current = window.setTimeout(() => {
      setArchiveHover(false);
      archiveCloseTimer.current = null;
    }, 120);
  }

  function setEditCardOpen(next: boolean) {
    clearTimer(pencilCloseTimer);
    if (next) {
      clearTimer(archiveCloseTimer);
      setArchiveHover(false);
      setPencilHover(true);
      return;
    }
    pencilCloseTimer.current = window.setTimeout(() => {
      setPencilHover(false);
      pencilCloseTimer.current = null;
    }, 120);
  }

  useEffect(() => {
    return () => {
      clearTimer(archiveCloseTimer);
      clearTimer(pencilCloseTimer);
    };
  }, []);

  // Prefetch on row hover so status is ready when the pencil card opens.
  useEffect(() => {
    if (!wantFetch) return;
    const gen = ++fetchGen.current;
    let cancelled = false;
    void (async () => {
      try {
        const diff = await window.sideboard.getDiff(primary.id, {
          scope: 'uncommitted',
        });
        if (cancelled || gen !== fetchGen.current) return;
        const s = diff.scopeStats?.uncommitted;
        setStat(
          s
            ? { additions: s.additions, deletions: s.deletions }
            : { additions: 0, deletions: 0 },
        );
        setLoaded(true);
      } catch {
        if (cancelled || gen !== fetchGen.current) return;
        setStat({ additions: 0, deletions: 0 });
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantFetch, primary.id, primary.updatedAt, primary.worktreePath]);

  const dirty =
    loaded && stat != null && (stat.additions > 0 || stat.deletions > 0);

  function requestArchive() {
    setArchiveHover(false);
    void window.sideboard
      .listWorktreeChats(primary.id)
      .then(onRequestArchive)
      .catch(alert);
  }

  return (
    <div
      className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}${archiving ? ' archiving' : ''}${unread ? ' unread' : ''}`}
      aria-busy={archiving}
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => {
        setRowHover(false);
        setEditCardOpen(false);
        setArchiveCardOpen(false);
      }}
      onClick={(e) => {
        if (archiving) return;
        onSelect(primary.id, e.metaKey || e.ctrlKey || e.shiftKey);
      }}
    >
      {archiving ? (
        <span className="thread-archive-spinner" aria-hidden />
      ) : (
        <span className={`dot ${primary.status}`} />
      )}
      <div className="thread-item-body">
        <div
          className="thread-title"
          title={
            primary.sourceType === 'orchestration'
              ? `${worktreeLabel} ✦`
              : worktreeLabel
          }
        >
          {worktreeLabel}
          {primary.sourceType === 'orchestration' ? ' ✦' : ''}
        </div>
        <div className="thread-meta">
          {archiving
            ? 'Archiving…'
            : [
                primary.agent,
                group.length > 1 ? `${group.length} chats` : null,
                primary.devPort ? `:${primary.devPort}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </div>
      </div>
      {!archiving ? (
        <div
          className="worktree-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {showArchive ? (
            <>
              <button
                type="button"
                ref={archiveBtnRef}
                className={`icon-btn worktree-remove-btn${archiveHover ? ' is-hot' : ''}`}
                title="Archive workspace"
                aria-label={`Archive ${worktreeLabel}`}
                aria-expanded={archiveHover}
                onMouseEnter={() => setArchiveCardOpen(true)}
                onMouseLeave={() => setArchiveCardOpen(false)}
                onFocus={() => setArchiveCardOpen(true)}
                onBlur={() => setArchiveCardOpen(false)}
                onClick={requestArchive}
              >
                ▤
              </button>
              <WorktreeArchiveCard
                open={archiveHover}
                anchorRef={archiveBtnRef}
                thread={primary}
                label={worktreeLabel}
                onArchive={requestArchive}
                onKeepOpen={setArchiveCardOpen}
              />
            </>
          ) : null}
          <button
            type="button"
            ref={pencilBtnRef}
            className={`icon-btn worktree-open-btn${pencilHover ? ' is-hot' : ''}`}
            title={`Open ${worktreeLabel}`}
            aria-label={`Open ${worktreeLabel}`}
            aria-expanded={pencilHover}
            onMouseEnter={() => setEditCardOpen(true)}
            onMouseLeave={() => setEditCardOpen(false)}
            onFocus={() => setEditCardOpen(true)}
            onBlur={() => setEditCardOpen(false)}
            onClick={() => onSelect(primary.id, false)}
          >
            ✎
          </button>
          <WorktreeEditCard
            open={pencilHover}
            anchorRef={pencilBtnRef}
            thread={primary}
            label={worktreeLabel}
            dirty={dirty}
            loaded={loaded}
            additions={stat?.additions ?? 0}
            deletions={stat?.deletions ?? 0}
            onOpen={() => {
              setEditCardOpen(false);
              onSelect(primary.id, false);
            }}
            onKeepOpen={setEditCardOpen}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  threads,
  selectedId,
  view,
  multiSelected,
  repoPath,
  workspaces = [],
  onShowBoard,
  onSelect,
  onNew,
  onPickRepo,
  onArchive,
  archivingId = null,
  onRemoveWorkspace,
  onToggleSidebar,
  onOpenSettings,
}: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState<{
    threadId: string;
    title: string;
    chatCount: number;
    /** When set, archive every id (orchestration group). */
    threadIds?: string[];
    removesWorktree?: boolean;
  } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{
    path: string;
    name: string;
    threadCount: number;
  } | null>(null);

  const q = filter.trim().toLowerCase();

  const globalThreads = useMemo(() => {
    return threads
      .filter((t) => {
        if (t.repoPath !== GLOBAL_WORKSPACE_ID) return false;
        if (!q) return true;
        const hay = `${t.title} ${t.agent} global orchestration`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [threads, q]);

  const byRepo = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      if (!isProjectPath(t.repoPath)) continue;
      if (q) {
        const hay =
          `${threadDisplayLabel(t)} ${t.title} ${t.branchName} ${t.agent} ${repoName(t.repoPath)}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const list = map.get(t.repoPath) ?? [];
      list.push(t);
      map.set(t.repoPath, list);
    }
    // Registered workspaces (and current repo) show even with zero threads
    const ensurePath = (path: string, nameHint?: string) => {
      if (!isProjectPath(path) || map.has(path)) return;
      if (
        q &&
        !repoName(path).toLowerCase().includes(q) &&
        !(nameHint ?? '').toLowerCase().includes(q)
      ) {
        return;
      }
      map.set(path, []);
    };
    for (const ws of workspaces) {
      ensurePath(ws.path, ws.name);
    }
    ensurePath(repoPath);
    return [...map.entries()].sort(([a], [b]) =>
      repoName(a).localeCompare(repoName(b)),
    );
  }, [threads, repoPath, workspaces, q]);

  return (
    <aside className="sidebar">
      <div className="sidebar-chrome">
        <SidebarToggle side="left" open onClick={onToggleSidebar} />
      </div>
      <div className="sidebar-header">
        <div className="brand">
          <BrandMark size="sm" />
          <span className="brand-name">Sideboard</span>
        </div>
        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-nav-btn${view === 'board' ? ' active' : ''}`}
            onClick={onShowBoard}
          >
            <span className="nav-glyph home" aria-hidden />
            Home
          </button>
          <button type="button" className="sidebar-nav-btn" onClick={() => onNew(repoPath || undefined)}>
            <span className="nav-glyph plus" aria-hidden />
            Create
          </button>
          <button
            type="button"
            className={`sidebar-nav-btn${filterOpen ? ' active' : ''}`}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <span className="nav-glyph search" aria-hidden />
            Search
          </button>
        </nav>
      </div>

      <div className="thread-list">
        <div className="sidebar-projects">
        {(!q ||
          globalThreads.length > 0 ||
          'orchestration'.includes(q) ||
          'global'.includes(q)) && (
          <div className="workspace-group">
            <div className="workspace-header">
              <button
                type="button"
                className="workspace-name-btn"
                title="Orchestration — coordinate work across registered workspaces"
                onClick={onShowBoard}
              >
                <span className="workspace-glyph" aria-hidden />
                <span className="workspace-name">Orchestration</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                title="New orchestration chat"
                onClick={() => onNew(undefined, 'orchestration')}
              >
                +
              </button>
            </div>
            {globalThreads.length === 0 ? (
              <div className="thread-meta" style={{ padding: '4px 8px' }}>
                No chats — open Home or use +
              </div>
            ) : (
              (() => {
                // One sidebar row (like a worktree); sibling chats live in the tab bar.
                const primary =
                  globalThreads.find((t) => t.id === selectedId) ??
                  [...globalThreads].sort((a, b) =>
                    b.updatedAt.localeCompare(a.updatedAt),
                  )[0]!;
                const active =
                  view === 'thread' &&
                  globalThreads.some((t) => t.id === selectedId);
                const selected = globalThreads.some((t) => multiSelected.has(t.id));
                const cloud = globalThreads.some((t) => isCloudCoordinatorThread(t));
                const unread = isWorktreeUnread(
                  unreadWorktreeKey(primary),
                  latestAgentResponseAt(globalThreads),
                  { active },
                );
                return (
                  <div className="worktree-block">
                    <div
                      className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}${unread ? ' unread' : ''}`}
                      onClick={(e) =>
                        onSelect(primary.id, e.metaKey || e.ctrlKey || e.shiftKey)
                      }
                    >
                      <span className={`dot ${primary.status}`} />
                      <div className="thread-item-body">
                        <div
                          className="thread-title"
                          title={
                            cloud
                              ? `${threadDisplayTitle(primary)} · Brightsy`
                              : threadDisplayTitle(primary)
                          }
                        >
                          {threadDisplayTitle(primary)}
                          {cloud ? ' · Brightsy' : ''}
                        </div>
                        <div className="thread-meta">
                          {primary.agent}
                          {globalThreads.length > 1
                            ? ` · ${globalThreads.length} chats`
                            : ''}
                          {primary.status !== 'idle' ? ` · ${primary.status}` : ''}
                        </div>
                      </div>
                      {onArchive && (
                        <button
                          type="button"
                          className="icon-btn worktree-remove-btn"
                          title="Archive orchestration chats"
                          aria-label="Archive orchestration chats"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveConfirm({
                              threadId: primary.id,
                              title: 'Orchestration',
                              chatCount: globalThreads.length,
                              threadIds: globalThreads.map((t) => t.id),
                              removesWorktree: false,
                            });
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        <div className="projects-header">
          <span className="section-label projects-label">Projects</span>
          <div className="projects-actions">
            <button
              type="button"
              className={`icon-btn${filterOpen ? ' active' : ''}`}
              title="Filter projects"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <span className="filter-glyph" aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Add workspace"
              onClick={onPickRepo}
            >
              <span className="folder-plus-glyph" aria-hidden />
            </button>
          </div>
        </div>

        {filterOpen && (
          <div className="sidebar-filter">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter workspaces & threads…"
            />
          </div>
        )}

        {byRepo.length === 0 && <div className="empty">No workspaces yet</div>}
        {byRepo.map(([path, repoThreads]) => (
          <div key={path} className="workspace-group">
            <div className="workspace-header">
              <div className="workspace-label">
                <button
                  type="button"
                  className="workspace-name-btn"
                  title={`New thread in ${repoName(path)}`}
                  onClick={() => onNew(path)}
                >
                  <span className="workspace-glyph" aria-hidden />
                  <span className="workspace-name" title={path}>
                    {repoName(path)}
                  </span>
                </button>
                {onRemoveWorkspace && (
                  <button
                    type="button"
                    className="icon-btn workspace-remove-btn"
                    title={`Remove ${repoName(path)}`}
                    aria-label={`Remove ${repoName(path)}`}
                    onClick={() =>
                      setRemoveConfirm({
                        path,
                        name: repoName(path),
                        threadCount: repoThreads.length,
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                type="button"
                className="icon-btn"
                title={`New thread in ${repoName(path)}`}
                onClick={() => onNew(path)}
              >
                +
              </button>
            </div>
            {repoThreads.length === 0 && (
              <div className="thread-meta" style={{ padding: '4px 8px' }}>
                No threads
              </div>
            )}
            {groupByWorktree(repoThreads).map((group) => {
              const primary =
                group.find((t) => t.id === selectedId) ??
                [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
              const worktreeLabel = worktreeDisplayLabelForGroup(group);
              const active =
                view === 'thread' && group.some((t) => t.id === selectedId);
              const selected =
                group.some((t) => multiSelected.has(t.id));
              const archiving = group.some((t) => t.id === archivingId);
              const unread = isWorktreeUnread(
                unreadWorktreeKey(primary),
                latestAgentResponseAt(group),
                { active },
              );
              return (
                <div key={primary.worktreePath} className="worktree-block">
                  <WorktreeSidebarRow
                    primary={primary}
                    group={group}
                    worktreeLabel={worktreeLabel}
                    active={active}
                    selected={selected}
                    archiving={archiving}
                    unread={unread}
                    onSelect={onSelect}
                    showArchive={Boolean(onArchive)}
                    onRequestArchive={(chats) =>
                      setArchiveConfirm({
                        threadId: primary.id,
                        title: worktreeLabel,
                        chatCount: chats.length,
                        threadIds: chats.map((c) => c.id),
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        ))}
        </div>
      </div>

      {archiveConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setArchiveConfirm(null)}
        >
          <div
            className="modal create-modal merge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-worktree-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="create-modal-content">
              <h3 id="archive-worktree-title" className="merge-modal-title">
                {archiveConfirm.removesWorktree === false
                  ? 'Archive orchestration?'
                  : 'Archive worktree?'}
              </h3>
              <p className="confirm-dialog-message">
                {closeChatTabMessage(archiveConfirm.title, archiveConfirm.chatCount, {
                  removesWorktree: archiveConfirm.removesWorktree !== false,
                })}
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button
                  type="button"
                  onClick={() => setArchiveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const ids = archiveConfirm.threadIds?.length
                      ? archiveConfirm.threadIds
                      : [archiveConfirm.threadId];
                    const meta = {
                      title: archiveConfirm.title,
                      removesWorktree: archiveConfirm.removesWorktree !== false,
                    };
                    // Close immediately — progress moves to the chat empty pane
                    // (same non-blocking pattern as worktree create).
                    setArchiveConfirm(null);
                    void Promise.resolve(onArchive?.(ids, meta)).catch(
                      (err: unknown) => {
                        window.alert(
                          err instanceof Error ? err.message : String(err),
                        );
                      },
                    );
                  }}
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removeConfirm && onRemoveWorkspace && (
        <div
          className="modal-backdrop"
          onClick={() => setRemoveConfirm(null)}
        >
          <div
            className="modal create-modal merge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-workspace-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="create-modal-content">
              <h3 id="remove-workspace-title" className="merge-modal-title">
                Remove {removeConfirm.name}?
              </h3>
              <p className="confirm-dialog-message">
                {removeConfirm.threadCount > 0
                  ? `Archive ${removeConfirm.threadCount} open thread${removeConfirm.threadCount === 1 ? '' : 's'} and remove this project from the sidebar. Chats stay in Settings → History.`
                  : 'Remove this project from the sidebar. You can add it again later.'}
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button
                  type="button"
                  onClick={() => setRemoveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const path = removeConfirm.path;
                    setRemoveConfirm(null);
                    void Promise.resolve(onRemoveWorkspace(path)).catch(
                      (err: unknown) => {
                        window.alert(
                          err instanceof Error ? err.message : String(err),
                        );
                      },
                    );
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-footer-btn"
          title="Sideboard on GitHub"
          aria-label="Sideboard on GitHub"
          onClick={() =>
            void window.sideboard.openExternal(
              'https://github.com/mattlevine/sideboard',
            )
          }
        >
          <span className="sidebar-footer-icon help" aria-hidden>
            ?
          </span>
        </button>
        <button
          type="button"
          className="sidebar-footer-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => onOpenSettings?.()}
        >
          <span className="sidebar-footer-icon gear" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
