import { useMemo, useState } from 'react';
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
import { BrandMark } from './BrandMark';
import { ConfirmDialog } from './ConfirmDialog';
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
  onArchive?: (threadId: string) => void | Promise<void>;
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
  } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{
    path: string;
    name: string;
    threadCount: number;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

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
              {globalThreads.length === 0 && (
                <button
                  type="button"
                  className="icon-btn"
                  title="New orchestration chat"
                  onClick={() => onNew(undefined, 'orchestration')}
                >
                  +
                </button>
              )}
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
                return (
                  <div className="worktree-block">
                    <div
                      className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}`}
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
              return (
                <div key={primary.worktreePath} className="worktree-block">
                  <div
                    className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}${archiving ? ' archiving' : ''}`}
                    aria-busy={archiving}
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
                    {!archiving && onArchive && (
                      <button
                        type="button"
                        className="icon-btn worktree-remove-btn"
                        title={`Archive ${worktreeLabel}`}
                        aria-label={`Archive ${worktreeLabel}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void window.sideboard
                            .listWorktreeChats(primary.id)
                            .then((chats) =>
                              setArchiveConfirm({
                                threadId: primary.id,
                                title: worktreeLabel,
                                chatCount: chats.length,
                              }),
                            )
                            .catch(alert);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        </div>
      </div>

      {archiveConfirm && (
        <ConfirmDialog
          title="Archive worktree?"
          message={closeChatTabMessage(archiveConfirm.title, archiveConfirm.chatCount)}
          confirmLabel="Archive"
          busy={archiveBusy}
          busyMessage="Stopping agents and removing the worktree…"
          onConfirm={() => {
            const id = archiveConfirm.threadId;
            setArchiveBusy(true);
            void Promise.resolve(onArchive?.(id))
              .then(() => {
                setArchiveConfirm(null);
              })
              .catch((err: unknown) => {
                window.alert(err instanceof Error ? err.message : String(err));
              })
              .finally(() => {
                setArchiveBusy(false);
              });
          }}
          onCancel={() => {
            if (!archiveBusy) setArchiveConfirm(null);
          }}
        />
      )}

      {removeConfirm && onRemoveWorkspace && (
        <ConfirmDialog
          title={`Remove ${removeConfirm.name}?`}
          message={
            removeConfirm.threadCount > 0
              ? `Archive ${removeConfirm.threadCount} open thread${removeConfirm.threadCount === 1 ? '' : 's'} and remove this project from the sidebar. Chats stay in Settings → History.`
              : 'Remove this project from the sidebar. You can add it again later.'
          }
          confirmLabel="Remove"
          busy={removeBusy}
          busyMessage={
            removeConfirm.threadCount > 0
              ? 'Archiving threads and removing project…'
              : 'Removing project…'
          }
          onConfirm={() => {
            const path = removeConfirm.path;
            setRemoveBusy(true);
            void Promise.resolve(onRemoveWorkspace(path))
              .then(() => {
                setRemoveConfirm(null);
              })
              .catch((err: unknown) => {
                window.alert(err instanceof Error ? err.message : String(err));
              })
              .finally(() => {
                setRemoveBusy(false);
              });
          }}
          onCancel={() => {
            if (!removeBusy) setRemoveConfirm(null);
          }}
        />
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
