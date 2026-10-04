import { useDeferredValue, useMemo, useState } from 'react';
import {
  threadDisplayLabel,
  worktreeDisplayLabelForGroup,
} from '@sideboard/worktree-labels';
import {
  DEFAULT_WORKTREE_SORT,
  groupHomeBoardWorktrees,
  reviewLabelForRepo,
  worktreeMatchesOwnership,
  type BoardOwnershipFilter,
  type WorktreeSortMode,
} from '@sideboard/home-board';
import type { Thread } from '@sideboard-ai/core';
import { WorktreeOwnershipFilter } from './WorktreeOwnershipFilter';
import { WorktreeSortSelect } from './WorktreeSortSelect';
import { GLOBAL_WORKSPACE_ID } from '../lib/global-workspace';
import { isGroupUnread } from '../lib/unread-worktrees';
import { pickWorktreeChat } from '../lib/worktree-tabs';
import { useCaffeinateHold } from '../lib/caffeinate-tab';
import { BrandMark } from './BrandMark';
import { CaffeinateBadge } from './CaffeinateBadge';
import type { NewChatTabOptions } from './ChatTabs';
import { SidebarToggle } from './SidebarToggle';
import { WorktreeNestedChats } from './WorktreeNestedChats';
import { WorktreeSidebarRow } from './WorktreeSidebarRow';

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
  /** Thread ids currently being archived (shows progress on those worktree rows). */
  archivingIds?: Set<string>;
  /** Unregister a project workspace (caller archives threads as needed). */
  onRemoveWorkspace?: (repoPath: string) => void | Promise<void>;
  onToggleSidebar: () => void;
  onOpenSettings?: () => void;
  worktreeSort?: WorktreeSortMode;
  onWorktreeSortChange?: (mode: WorktreeSortMode) => void;
  ownership?: BoardOwnershipFilter;
  onOwnershipChange?: (filter: BoardOwnershipFilter) => void;
  githubLogin?: string | null;
  /** Settings → Projects ready-for-review GitHub labels, keyed by repo path. */
  projectReviewLabels?: Record<string, string>;
  /** Open the in-app PR page for this worktree (not GitHub). */
  onOpenPr?: (threadId: string) => void;
  onMarkUnread?: (thread: Thread) => void;
  onRenameChat?: (id: string, title: string) => void;
  onCloseChat?: (thread: Thread) => void;
  onAddAgent?: (fromThreadId: string, opts: NewChatTabOptions) => void;
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
  archivingIds = new Set(),
  onRemoveWorkspace,
  onToggleSidebar,
  onOpenSettings,
  worktreeSort = DEFAULT_WORKTREE_SORT,
  onWorktreeSortChange,
  ownership = 'all',
  onOwnershipChange,
  githubLogin = null,
  projectReviewLabels = {},
  onOpenPr,
  onMarkUnread,
  onRenameChat,
  onCloseChat,
  onAddAgent,
}: Props) {
  const caffeinateHold = useCaffeinateHold();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState<{
    path: string;
    name: string;
    threadCount: number;
  } | null>(null);

  function runArchive(
    ids: string[],
    meta: { title: string; removesWorktree: boolean },
  ) {
    void Promise.resolve(onArchive?.(ids, meta)).catch((err: unknown) => {
      window.alert(err instanceof Error ? err.message : String(err));
    });
  }

  const deferredFilter = useDeferredValue(filter);
  const q = deferredFilter.trim().toLowerCase();

  const globalThreads = useMemo(() => {
    return threads
      .filter((t) => {
        if (t.repoPath !== GLOBAL_WORKSPACE_ID) return false;
        if (!q) return true;
        const hay = `${t.title} ${t.agent} global orchestration`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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

  const groupedByRepo = useMemo(() => {
    return byRepo.map(([path, repoThreads]) => ({
      path,
      repoThreads,
      groups: groupHomeBoardWorktrees(repoThreads, worktreeSort).filter((group) =>
        worktreeMatchesOwnership(group, ownership, githubLogin ?? ''),
      ),
    }));
  }, [byRepo, worktreeSort, ownership, githubLogin]);

  return (
    <aside className="sidebar">
      <div className="sidebar-chrome">
        <SidebarToggle side="left" open onClick={onToggleSidebar} />
      </div>
      <div className="sidebar-header">
        <div className="brand">
          <BrandMark size="sm" />
          <span className="brand-name">Sideboard</span>
          {caffeinateHold?.appCaffeinated ? <CaffeinateBadge /> : null}
        </div>
        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-nav-btn${view === 'board' ? ' active' : ''}`}
            onClick={onShowBoard}
          >
            <span className="nav-glyph board" aria-hidden>
              <span className="nav-glyph-col">
                <i />
                <i />
              </span>
              <span className="nav-glyph-col">
                <i />
              </span>
              <span className="nav-glyph-col">
                <i />
                <i />
                <i />
              </span>
            </span>
            Board
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
                title="New orchestration chat"
                onClick={() => onNew(undefined, 'orchestration')}
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
                No chats — open Board or use +
              </div>
            ) : (
              <div className="worktree-block">
                {/* Same nested rows as worktree sub-agents: logo + name, drag-sort. */}
                <WorktreeNestedChats
                  chats={globalThreads}
                  worktreeKey={GLOBAL_WORKSPACE_ID}
                  parentTitle="Orchestration"
                  selectedId={selectedId}
                  active={view === 'thread'}
                  multiSelected={multiSelected}
                  onSelect={onSelect}
                  onMarkUnread={onMarkUnread}
                  onRenameChat={onRenameChat}
                  onCloseChat={onCloseChat}
                />
              </div>
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
            {onOwnershipChange ? (
              <WorktreeOwnershipFilter
                variant="icon"
                value={ownership}
                onChange={onOwnershipChange}
                githubLogin={githubLogin}
              />
            ) : null}
            {onWorktreeSortChange ? (
              <WorktreeSortSelect
                variant="icon"
                value={worktreeSort}
                onChange={onWorktreeSortChange}
              />
            ) : null}
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

        {groupedByRepo.length === 0 && <div className="empty">No workspaces yet</div>}
        {groupedByRepo.map(({ path, repoThreads, groups }) => (
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
            {groups.map((group) => {
              const primary =
                pickWorktreeChat(group, selectedId) ?? group[0]!;
              const worktreeLabel = worktreeDisplayLabelForGroup(group);
              const active =
                view === 'thread' && group.some((t) => t.id === selectedId);
              const selected =
                group.some((t) => multiSelected.has(t.id));
              const archiving = group.some((t) => archivingIds.has(t.id));
              const unread = isGroupUnread(group, {
                activeChatId: active ? selectedId : null,
              });
              return (
                <div key={primary.worktreePath} className="worktree-block">
                  <WorktreeSidebarRow
                    primary={primary}
                    group={group}
                    worktreeLabel={worktreeLabel}
                    githubLogin={githubLogin}
                    reviewLabel={reviewLabelForRepo(projectReviewLabels, path)}
                    active={active}
                    selected={selected}
                    selectedId={selectedId}
                    multiSelected={multiSelected}
                    archiving={archiving}
                    unread={unread}
                    onSelect={onSelect}
                    onOpenPr={onOpenPr}
                    onMarkUnread={onMarkUnread}
                    onRenameChat={onRenameChat}
                    onCloseChat={onCloseChat}
                    onAddAgent={onAddAgent}
                    showArchive={Boolean(onArchive)}
                    onRequestArchive={(chats) =>
                      runArchive(
                        chats.map((c) => c.id),
                        {
                          title: worktreeLabel,
                          removesWorktree: !primary.cowboy,
                        },
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
        ))}
        </div>
      </div>

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
          title="Sideboard"
          aria-label="Sideboard"
          onClick={() =>
            void window.sideboard.openExternal('https://www.sideboard.cloud')
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
