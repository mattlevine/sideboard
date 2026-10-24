import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { reviewLabelForRepo } from '@sideboard/home-board';
import { worktreeDisplayLabelForGroup } from '@sideboard/worktree-labels';
import type { Thread } from '@sideboard-ai/core';
import { isGroupUnread } from '../lib/unread-worktrees';
import { pickWorktreeChat } from '../lib/worktree-tabs';
import type { NewChatTabOptions } from './ChatTabs';
import { WorktreeSidebarRow } from './WorktreeSidebarRow';

export type ProjectsBrowserRepo = {
  path: string;
  repoThreads: Thread[];
  groups: Thread[][];
};

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

function projectForSelection(
  repos: ProjectsBrowserRepo[],
  selectedId: string | null,
): string {
  if (selectedId) {
    const hit = repos.find(
      (repo) =>
        repo.repoThreads.some((thread) => thread.id === selectedId) ||
        repo.groups.some((group) => group.some((thread) => thread.id === selectedId)),
    );
    if (hit) return hit.path;
  }
  return repos[0]?.path ?? '';
}

/** Outward arrows: open the narrow sidebar list in a larger window. */
export function ProjectsExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.2 2.5H13.5V6.8M6.8 13.5H2.5V9.2M13.2 2.8 9.4 6.6M2.8 13.2l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Settings-sized browser for the left sidebar project list.
 * Left column is projects; the main pane is that project's workspaces.
 */
export function ProjectsBrowserModal({
  repos,
  selectedId,
  view,
  multiSelected,
  archivingIds,
  githubLogin,
  projectReviewLabels,
  tagFilters,
  onClose,
  onSelect,
  onNew,
  onOpenPr,
  onMarkUnread,
  onRenameChat,
  onCloseChat,
  onAddAgent,
  onSetWorkspaceTags,
  onFilterTag,
  onRequestArchive,
}: {
  repos: ProjectsBrowserRepo[];
  selectedId: string | null;
  view: 'board' | 'thread';
  multiSelected: Set<string>;
  archivingIds: Set<string>;
  githubLogin?: string | null;
  projectReviewLabels: Record<string, string>;
  tagFilters: string[];
  onClose: () => void;
  onSelect: (id: string, multi: boolean) => void;
  onNew: (repoPath: string) => void;
  onOpenPr?: (threadId: string) => void;
  onMarkUnread?: (thread: Thread) => void;
  onRenameChat?: (id: string, title: string) => void;
  onCloseChat?: (thread: Thread) => void;
  onAddAgent?: (fromThreadId: string, opts: NewChatTabOptions) => void;
  onSetWorkspaceTags?: (threadId: string, tags: string[]) => void;
  onFilterTag: (tag: string) => void;
  onRequestArchive?: (
    ids: string[],
    meta: { title: string; removesWorktree: boolean },
  ) => void;
}) {
  const [query, setQuery] = useState('');
  const [path, setPath] = useState(() => projectForSelection(repos, selectedId));
  const q = query.trim().toLowerCase();

  const shown = useMemo(() => {
    if (!q) return repos;
    return repos
      .map((repo) => {
        const name = repoName(repo.path).toLowerCase();
        if (name.includes(q)) return repo;
        const groups = repo.groups.filter((group) => {
          const label = worktreeDisplayLabelForGroup(group).toLowerCase();
          if (label.includes(q)) return true;
          return group.some((thread) =>
            `${thread.title} ${thread.branchName} ${thread.agent} ${(thread.tags ?? []).join(' ')}`
              .toLowerCase()
              .includes(q),
          );
        });
        return { ...repo, groups };
      })
      .filter(
        (repo) =>
          repo.groups.length > 0 || repoName(repo.path).toLowerCase().includes(q),
      );
  }, [repos, q]);

  useEffect(() => {
    if (shown.some((repo) => repo.path === path)) return;
    setPath(shown[0]?.path ?? '');
  }, [shown, path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = shown.find((repo) => repo.path === path) ?? null;
  const name = current ? repoName(current.path) : 'Projects';

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal projects-browser-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-browser-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title" id="projects-browser-title">
              Projects
            </div>
            <input
              className="projects-browser-search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter projects…"
              aria-label="Filter projects"
            />
            {shown.length === 0 ? (
              <p className="projects-browser-empty">Nothing matched</p>
            ) : (
              shown.map((repo) => (
                <button
                  key={repo.path}
                  type="button"
                  className={`settings-nav-btn${repo.path === path ? ' active' : ''}`}
                  title={repo.path}
                  onClick={() => setPath(repo.path)}
                >
                  <span className="projects-browser-name">{repoName(repo.path)}</span>
                  <span className="projects-browser-count">{repo.groups.length}</span>
                </button>
              ))
            )}
          </aside>
          <div className="settings-main">
            <div className="settings-main-header">
              <h3 title={current?.path}>{name}</h3>
              <div className="projects-browser-header-actions">
                {current ? (
                  <button
                    type="button"
                    title={`New workspace in ${name}`}
                    onClick={() => onNew(current.path)}
                  >
                    New workspace
                  </button>
                ) : null}
                <button type="button" className="icon-btn" title="Close" onClick={onClose}>
                  ✕
                </button>
              </div>
            </div>
            <div className="settings-body">
              {!current ? (
                <p className="projects-browser-empty">
                  {repos.length === 0 ? 'No projects yet' : 'Nothing matched'}
                </p>
              ) : current.groups.length === 0 ? (
                <p className="projects-browser-empty">
                  {current.repoThreads.length === 0
                    ? 'No workspaces'
                    : 'No workspaces match'}
                </p>
              ) : (
                <div className="projects-browser-list">
                  {current.groups.map((group) => {
                    const primary = pickWorktreeChat(group, selectedId) ?? group[0]!;
                    const worktreeLabel = worktreeDisplayLabelForGroup(group);
                    const active =
                      view === 'thread' && group.some((thread) => thread.id === selectedId);
                    return (
                      <div key={primary.worktreePath} className="worktree-block">
                        <WorktreeSidebarRow
                          primary={primary}
                          group={group}
                          worktreeLabel={worktreeLabel}
                          githubLogin={githubLogin}
                          reviewLabel={reviewLabelForRepo(projectReviewLabels, current.path)}
                          active={active}
                          selected={group.some((thread) => multiSelected.has(thread.id))}
                          selectedId={selectedId}
                          multiSelected={multiSelected}
                          archiving={group.some((thread) => archivingIds.has(thread.id))}
                          unread={isGroupUnread(group, {
                            activeChatId: active ? selectedId : null,
                          })}
                          onSelect={onSelect}
                          onActiveClick={onClose}
                          onOpenPr={onOpenPr}
                          onMarkUnread={onMarkUnread}
                          onRenameChat={onRenameChat}
                          onCloseChat={onCloseChat}
                          onAddAgent={onAddAgent}
                          onSetTags={
                            onSetWorkspaceTags
                              ? (tags) => onSetWorkspaceTags(primary.id, tags)
                              : undefined
                          }
                          onFilterTag={onFilterTag}
                          selectedTags={tagFilters}
                          showArchive={Boolean(onRequestArchive)}
                          onRequestArchive={
                            onRequestArchive
                              ? (chats) =>
                                  onRequestArchive(
                                    chats.map((chat) => chat.id),
                                    {
                                      title: worktreeLabel,
                                      removesWorktree: !primary.cowboy,
                                    },
                                  )
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
