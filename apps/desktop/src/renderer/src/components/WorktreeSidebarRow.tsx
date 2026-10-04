import { useEffect, useRef, useState } from 'react';
import { worktreeBoardStatus } from '@sideboard/home-board';
import { worktreeAnchorLabel } from '@sideboard/worktree-labels';
import type { AgentKind, Autonomy, ThinkingEffort, Thread } from '@sideboard-ai/core';
import { nestedChatDisplayTitle } from '../lib/nested-chat-title';
import { loadThreadDefaults } from '../lib/thread-defaults';
import { unreadWorktreeKey } from '../lib/unread-worktrees';
import {
  resolveSidebarChatExpanded,
  SIDEBAR_NEST_MIN_CHATS,
  worktreeSidebarMeta,
} from '../lib/sidebar-chat-expand';
import { useWorktreeDirtyStat } from '../lib/worktree-diff-stat';
import { AgentKindIcon } from './AgentKindIcon';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import type { NewChatTabOptions } from './ChatTabs';
import { ThreadStatusIcon } from './ThreadStatusIcon';
import { WorktreeEditCard } from './WorktreeEditCard';
import { WorktreeNestedChats } from './WorktreeNestedChats';
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
  onAddAgent,
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
  onAddAgent?: (fromThreadId: string, opts: NewChatTabOptions) => void;
  multiSelected: Set<string>;
}) {
  const [gitCardOpen, setGitCardOpenState] = useState(false);
  const [collapsedWhileSelected, setCollapsedWhileSelected] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addDefaults, setAddDefaults] = useState<{
    agent: AgentKind;
    model: string | null;
    autonomy: Autonomy;
    effort: ThinkingEffort;
    fast: boolean;
  }>({
    agent: 'claude',
    model: null,
    autonomy: 'default',
    effort: 'high',
    fast: false,
  });
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
  const anchor = orch ? null : worktreeAnchorLabel(group);
  const parentTitle = orch ? worktreeLabel : (anchor?.title || worktreeLabel);
  const branchLine = !orch ? (anchor?.subtitle ?? null) : null;
  const metaLine = worktreeSidebarMeta({
    agent: orch ? '' : primary.agent,
    chatCount: orch ? 1 : group.length,
    branch: branchLine,
    port: orch ? null : (group.find((t) => t.devPort != null)?.devPort ?? null),
    archiving,
  });
  const showChevron =
    !orch && active && !archiving && group.length >= SIDEBAR_NEST_MIN_CHATS;
  const showMetaRow = Boolean(metaLine) || showChevron;
  const renamingParent = orch && editingId === primary.id;
  const showAddAgent = Boolean(onAddAgent) && !orch && !archiving;
  const showWorktreeActions = showArchive || showAddAgent;

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

  async function openAddAgent() {
    setGitCardOpen(false);
    const defaults = await loadThreadDefaults();
    setAddDefaults({
      agent: defaults.agent,
      model: defaults.model,
      autonomy: 'default',
      effort: defaults.effort,
      fast: defaults.fast,
    });
    setAddOpen(true);
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
          if (!orch && !addOpen) setGitCardOpen(true);
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
            {orch ? <AgentKindIcon agent={primary.agent} /> : null}
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
          {showMetaRow ? (
            <div className="worktree-agents-row">
              {metaLine ? <div className="thread-meta">{metaLine}</div> : null}
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
          ) : null}
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
        ) : !archiving && showWorktreeActions ? (
          <div
            className={`worktree-row-actions${addOpen ? ' is-open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {showArchive ? (
              <button
                type="button"
                className="icon-btn worktree-remove-btn"
                aria-label={`Archive ${parentTitle}`}
                title="Archive"
                onClick={requestArchive}
              >
                ▤
              </button>
            ) : null}
            {showAddAgent ? (
              <button
                type="button"
                className="icon-btn worktree-add-agent-btn"
                aria-label={`Add agent to ${parentTitle}`}
                title="Add agent"
                onClick={() => void openAddAgent()}
              >
                +
              </button>
            ) : null}
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
      <AgentOptionsPicker
        open={addOpen}
        value={addDefaults}
        title="Add agent"
        confirmLabel="Add agent"
        onClose={() => setAddOpen(false)}
        onApply={(next) => {
          onAddAgent?.(primary.id, {
            agent: next.agent,
            model: next.model,
            autonomy: next.autonomy,
            effort: next.effort,
            fast: next.fast,
          });
        }}
      />
      {expanded ? (
        <WorktreeNestedChats
          chats={group}
          worktreeKey={expandKey}
          parentTitle={parentTitle}
          selectedId={selectedId}
          active={active}
          multiSelected={multiSelected}
          onSelect={onSelect}
          onMarkUnread={onMarkUnread}
          onRenameChat={onRenameChat}
          onCloseChat={onCloseChat}
        />
      ) : null}
    </div>
  );
}
