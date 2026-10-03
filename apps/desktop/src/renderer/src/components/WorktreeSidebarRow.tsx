import { useEffect, useRef, useState } from 'react';
import { worktreeBoardStatus } from '@sideboard/home-board';
import { worktreeAnchorLabel } from '@sideboard/worktree-labels';
import type { Thread } from '@sideboard-ai/core';
import { nestedChatDisplayTitle } from '../lib/nested-chat-title';
import { isChatUnread, unreadWorktreeKey } from '../lib/unread-worktrees';
import { orderWorktreeChatsForKey } from '../lib/worktree-tabs';
import {
  resolveSidebarChatExpanded,
  worktreeSidebarMeta,
} from '../lib/sidebar-chat-expand';
import { useWorktreeDirtyStat } from '../lib/worktree-diff-stat';
import { ThreadStatusIcon } from './ThreadStatusIcon';
import { WorktreeEditCard } from './WorktreeEditCard';
import { WorktreePrBadges } from './WorktreePrBadges';

export function WorktreeSidebarRow({
  primary,
  group,
  worktreeLabel,
  active,
  selected,
  selectedId,
  archiving,
  unread,
  githubLogin,
  reviewLabel,
  onSelect,
  showArchive,
  onRequestArchive,
  onOpenPr,
  onMarkUnread,
  onRenameChat,
  onCloseChat,
  multiSelected,
}: {
  primary: Thread;
  group: Thread[];
  worktreeLabel: string;
  active: boolean;
  selected: boolean;
  selectedId: string | null;
  archiving: boolean;
  unread: boolean;
  githubLogin?: string | null;
  reviewLabel?: string | null;
  onSelect: (id: string, multi: boolean) => void;
  showArchive?: boolean;
  onRequestArchive: (chats: Thread[]) => void;
  onOpenPr?: (threadId: string) => void;
  onMarkUnread?: (thread: Thread) => void;
  onRenameChat?: (id: string, title: string) => void;
  onCloseChat?: (thread: Thread) => void;
  multiSelected: Set<string>;
}) {
  const [gitCardOpen, setGitCardOpenState] = useState(false);
  const [collapsedWhileSelected, setCollapsedWhileSelected] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rowRef = useRef<HTMLDivElement>(null);
  const gitCloseTimer = useRef<number | null>(null);
  const { stat, loaded } = useWorktreeDirtyStat(
    primary.id,
    primary.worktreePath,
    primary.status,
  );

  function clearTimer(ref: { current: number | null }) {
    if (ref.current != null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }

  function setGitCardOpen(next: boolean) {
    clearTimer(gitCloseTimer);
    if (next) {
      setGitCardOpenState(true);
      return;
    }
    gitCloseTimer.current = window.setTimeout(() => {
      setGitCardOpenState(false);
      gitCloseTimer.current = null;
    }, 120);
  }

  useEffect(() => {
    return () => {
      clearTimer(gitCloseTimer);
    };
  }, []);

  useEffect(() => {
    if (!active) setCollapsedWhileSelected(false);
  }, [active]);

  const orch = primary.sourceType === 'orchestration';
  const dirty = !orch && loaded && Boolean(stat?.dirty);
  const expandKey = unreadWorktreeKey(primary);
  const expanded = resolveSidebarChatExpanded({
    chatCount: group.length,
    selected: active,
    collapsedWhileSelected,
  });
  const nestedChats = expanded ? orderWorktreeChatsForKey(group, expandKey) : [];
  const anchor = orch ? null : worktreeAnchorLabel(group);
  const parentTitle = orch ? worktreeLabel : (anchor?.title || worktreeLabel);
  const branchLine = !orch ? (anchor?.subtitle ?? null) : null;
  const metaLine = worktreeSidebarMeta({
    agent: primary.agent,
    chatCount: orch ? 1 : group.length,
    branch: branchLine,
    port: orch ? null : (group.find((t) => t.devPort != null)?.devPort ?? null),
    archiving,
  });
  const showChevron = !orch && active && !archiving && group.length > 1;
  const renamingParent = orch && editingId === primary.id;

  function requestArchive() {
    if (orch) {
      onRequestArchive(group);
      return;
    }
    void window.sideboard
      .listWorktreeChats(primary.id)
      .then(onRequestArchive)
      .catch(alert);
  }

  function toggleExpanded(e: { stopPropagation(): void }) {
    e.stopPropagation();
    setCollapsedWhileSelected((was) => !was);
  }

  function commitRename() {
    if (!editingId || !onRenameChat) {
      setEditingId(null);
      return;
    }
    const title = draft.trim();
    const current = group.find((c) => c.id === editingId);
    const displayed = current
      ? nestedChatDisplayTitle(current, parentTitle)
      : '';
    if (title && title !== displayed) onRenameChat(editingId, title);
    setEditingId(null);
  }

  return (
    <div
      className={`worktree-card${expanded ? ' is-expanded' : ''}${
        selected ? ' is-selected' : ''
      }`}
    >
      <div
        ref={rowRef}
        className={`thread-item worktree-parent${expanded ? ' is-open' : ''}${
          active && !expanded ? ' active' : ''
        }${archiving ? ' archiving' : ''}${unread ? ' unread' : ''}`}
        aria-busy={archiving}
        onMouseEnter={() => {
          if (!orch) setGitCardOpen(true);
        }}
        onMouseLeave={() => {
          if (!orch) setGitCardOpen(false);
        }}
        onClick={(e) => {
          if (archiving) return;
          const additive = e.metaKey || e.ctrlKey || e.shiftKey;
          if (active && !additive) {
            if (collapsedWhileSelected) setCollapsedWhileSelected(false);
            return;
          }
          onSelect(primary.id, additive);
        }}
        onContextMenu={(e) => {
          if (!onMarkUnread || archiving) return;
          e.preventDefault();
          onMarkUnread(primary);
        }}
      >
        {archiving ? (
          <span className="thread-archive-spinner" aria-hidden />
        ) : (
          <ThreadStatusIcon
            status={worktreeBoardStatus(group)}
            dirty={dirty}
            dirtyLoaded={loaded}
            additions={stat?.additions ?? 0}
            deletions={stat?.deletions ?? 0}
            unread={unread}
          />
        )}
        <div className="thread-item-body">
          <div
            className="thread-title"
            title={parentTitle}
            onDoubleClick={(e) => {
              if (!orch || !onRenameChat || archiving) return;
              e.preventDefault();
              e.stopPropagation();
              setEditingId(primary.id);
              setDraft(parentTitle);
            }}
          >
            {renamingParent ? (
              <input
                className="nested-chat-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  }
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <span className="thread-title-text">{parentTitle}</span>
            )}
            {primary.cowboy ? <span className="board-badge">cowboy</span> : null}
            {orch ? null : (
              <WorktreePrBadges
                group={group}
                viewerLogin={githubLogin}
                reviewLabel={reviewLabel}
              />
            )}
          </div>
          <div className="worktree-agents-row">
            <div className="thread-meta">{metaLine}</div>
            {showChevron ? (
              <button
                type="button"
                className={`worktree-expand${expanded ? ' is-open' : ''}`}
                aria-label={expanded ? 'Collapse agents' : 'Expand agents'}
                aria-expanded={expanded}
                onClick={toggleExpanded}
              >
                {expanded ? '▾' : '▸'}
              </button>
            ) : null}
          </div>
        </div>
        {!archiving && orch && onCloseChat ? (
          <div
            className="worktree-row-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="nested-chat-close"
              title="Close chat"
              aria-label={`Close ${parentTitle}`}
              onClick={() => onCloseChat(primary)}
            >
              ×
            </button>
          </div>
        ) : !archiving && showArchive ? (
          <div
            className="worktree-row-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="icon-btn worktree-remove-btn"
              aria-label={`Archive ${parentTitle}`}
              title="Archive"
              onClick={requestArchive}
            >
              ▤
            </button>
          </div>
        ) : null}
        {!archiving && !orch ? (
          <WorktreeEditCard
            open={gitCardOpen}
            anchorRef={rowRef}
            thread={primary}
            group={group}
            label={parentTitle}
            dirty={dirty}
            loaded={loaded}
            additions={stat?.additions ?? 0}
            deletions={stat?.deletions ?? 0}
            onOpen={() => {
              setGitCardOpen(false);
              onSelect(primary.id, false);
            }}
            onOpenPr={() => {
              setGitCardOpen(false);
              onOpenPr?.(primary.id);
            }}
            onKeepOpen={setGitCardOpen}
          />
        ) : null}
      </div>
      {nestedChats.length > 0 ? (
        <div className="worktree-chats">
          {nestedChats.map((chat) => {
            const chatActive = active && chat.id === selectedId;
            const chatUnread = isChatUnread(chat, { active: chatActive });
            const renaming = editingId === chat.id;
            const chatTitle = nestedChatDisplayTitle(chat, parentTitle);
            return (
              <div
                key={chat.id}
                className={`thread-item nested${chatActive ? ' active' : ''}${
                  multiSelected.size > 1 && multiSelected.has(chat.id)
                    ? ' selected'
                    : ''
                }${chatUnread ? ' unread' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (renaming) return;
                  onSelect(chat.id, e.metaKey || e.ctrlKey || e.shiftKey);
                }}
                onDoubleClick={(e) => {
                  if (!onRenameChat) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingId(chat.id);
                  setDraft(chatTitle);
                }}
                onContextMenu={(e) => {
                  if (!onMarkUnread) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onMarkUnread(chat);
                }}
              >
                <ThreadStatusIcon status={chat.status} unread={chatUnread} />
                {renaming ? (
                  <input
                    className="nested-chat-input"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span className="thread-title-text" title={chatTitle}>
                    {chatTitle}
                  </span>
                )}
                <span className="nested-chat-agent">{chat.agent}</span>
                {onCloseChat ? (
                  <button
                    type="button"
                    className="nested-chat-close"
                    title="Close chat"
                    aria-label={`Close ${chatTitle}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseChat(chat);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
