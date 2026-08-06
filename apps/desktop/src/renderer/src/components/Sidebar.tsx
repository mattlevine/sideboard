import { useMemo, useState } from 'react';
import {
  normalizeWorktreePath,
  threadDisplayLabel,
  worktreeDisplayLabelForGroup,
} from '@sideboard/worktree-labels';
import type { Thread } from '@sideboard/core';
import {
  GLOBAL_WORKSPACE_ID,
  isCloudCoordinatorThread,
  threadDisplayTitle,
} from '../lib/global-workspace';
import { BrandMark } from './BrandMark';
import { SidebarToggle } from './SidebarToggle';

interface Props {
  threads: Thread[];
  archived: Thread[];
  selectedId: string | null;
  view: 'board' | 'thread';
  multiSelected: Set<string>;
  repoPath: string;
  onShowBoard: () => void;
  onSelect: (id: string, multi: boolean) => void;
  onNew: (repoPath?: string, mode?: 'quick' | 'orchestration') => void;
  onPickRepo: () => void;
  onRestore: (id: string) => void;
  onCreatePr?: (threadId: string, opts?: { draft?: boolean; web?: boolean }) => void;
  onForkChat?: (threadId: string) => void;
  onToggleSidebar: () => void;
  onOpenSettings?: () => void;
}

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
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
  archived,
  selectedId,
  view,
  multiSelected,
  repoPath,
  onShowBoard,
  onSelect,
  onNew,
  onPickRepo,
  onRestore,
  onCreatePr,
  onForkChat,
  onToggleSidebar,
  onOpenSettings,
}: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [toolsFor, setToolsFor] = useState<string | null>(null);

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
      if (t.repoPath === GLOBAL_WORKSPACE_ID) continue;
      if (q) {
        const hay =
          `${threadDisplayLabel(t)} ${t.title} ${t.branchName} ${t.agent} ${repoName(t.repoPath)}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const list = map.get(t.repoPath) ?? [];
      list.push(t);
      map.set(t.repoPath, list);
    }
    // Ensure current repo shows even with zero threads (unless filtering)
    if (!q && repoPath && repoPath !== GLOBAL_WORKSPACE_ID && !map.has(repoPath)) {
      map.set(repoPath, []);
    }
    // When filtering, also show matching workspace names with empty lists if name matches
    if (q && repoPath && repoName(repoPath).toLowerCase().includes(q) && !map.has(repoPath)) {
      map.set(repoPath, []);
    }
    return [...map.entries()].sort(([a], [b]) =>
      repoName(a).localeCompare(repoName(b)),
    );
  }, [threads, repoPath, q]);

  const filteredArchived = useMemo(() => {
    if (!q) return archived;
    return archived.filter((t) =>
      `${threadDisplayLabel(t)} ${t.title} ${t.branchName} ${repoName(t.repoPath)}`
        .toLowerCase()
        .includes(q),
    );
  }, [archived, q]);

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

      <div
        className={`thread-list${filteredArchived.length > 0 ? ' has-history' : ''}`}
      >
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
                      <div>
                        <div className="thread-title">
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
              const menuOpen = toolsFor === primary.worktreePath;
              return (
                <div key={primary.worktreePath} className="worktree-block">
                  <div
                    className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}`}
                    onClick={(e) => onSelect(primary.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                  >
                    <span className={`dot ${primary.status}`} />
                    <div>
                      <div className="thread-title">
                        {worktreeLabel}
                        {primary.sourceType === 'orchestration' ? ' ✦' : ''}
                      </div>
                      <div className="thread-meta">
                        {primary.agent}
                        {group.length > 1 ? ` · ${group.length} chats` : ''}
                        {primary.devPort ? ` · :${primary.devPort}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn worktree-tools-btn"
                      title="Worktree tools"
                      onClick={(e) => {
                        e.stopPropagation();
                        setToolsFor(menuOpen ? null : primary.worktreePath);
                      }}
                    >
                      ▾
                    </button>
                  </div>
                  {menuOpen && (
                    <div className="tool-menu sidebar-tool-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setToolsFor(null);
                          onCreatePr?.(primary.id);
                        }}
                      >
                        <span className="tool-menu-icon">⎇</span>
                        <span>Create PR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setToolsFor(null);
                          onCreatePr?.(primary.id, { draft: true });
                        }}
                      >
                        <span className="tool-menu-icon">⎇</span>
                        <span>Create draft PR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setToolsFor(null);
                          onCreatePr?.(primary.id, { web: true });
                        }}
                      >
                        <span className="tool-menu-icon">↗</span>
                        <span>Create PR manually</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setToolsFor(null);
                          onForkChat?.(primary.id);
                        }}
                      >
                        <span className="tool-menu-icon">⎇</span>
                        <span>Fork to new tab</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        </div>

        {filteredArchived.length > 0 && (
          <div className="sidebar-history">
            <div className="section-label">History</div>
            <div className="sidebar-history-list">
              {filteredArchived.map((t) => (
                <div key={t.id} className="thread-item" onClick={() => onSelect(t.id, false)}>
                  <span className="dot archived" />
                  <div>
                    <div className="thread-title">{threadDisplayLabel(t)}</div>
                    <div className="thread-meta">archived · {t.agent}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestore(t.id);
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-footer-btn"
          title="Get a Cursor API key"
          aria-label="Get a Cursor API key"
          onClick={() =>
            void window.sideboard.openExternal(
              'https://cursor.com/dashboard/integrations',
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
