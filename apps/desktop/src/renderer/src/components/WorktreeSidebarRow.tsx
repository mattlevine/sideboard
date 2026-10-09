import { useEffect, useRef, useState } from 'react';
import { worktreeAgentBlock, worktreeBoardStatus } from '@sideboard/home-board';
import { worktreeAnchorLabel, workspaceTagsFromGroup } from '@sideboard/worktree-labels';
import type { AgentKind, Autonomy, ThinkingEffort, Thread } from '@sideboard-ai/core';
import { loadThreadDefaults } from '../lib/thread-defaults';
import { unreadWorktreeKey } from '../lib/unread-worktrees';
import {
  resolveSidebarChatExpanded,
  SIDEBAR_NEST_MIN_CHATS,
  worktreeSidebarMeta,
} from '../lib/sidebar-chat-expand';
import { useWorktreeDirtyStat } from '../lib/worktree-diff-stat';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import type { NewChatTabOptions } from './ChatTabs';
import { ThreadStatusIcon } from './ThreadStatusIcon';
import { WorktreeEditCard } from './WorktreeEditCard';
import { WorktreeNestedChats } from './WorktreeNestedChats';
import { WorktreePrBadges } from './WorktreePrBadges';
import { WorkspaceTagEditor, WorkspaceTags } from './WorkspaceTags';

function TagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.2 3.4A1.2 1.2 0 0 1 3.4 2.2h3.7c.32 0 .62.13.85.35l5.5 5.5a1.2 1.2 0 0 1 0 1.7l-3.7 3.7a1.2 1.2 0 0 1-1.7 0l-5.5-5.5a1.2 1.2 0 0 1-.35-.85V3.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="5.3" cy="5.3" r="0.9" fill="currentColor" />
    </svg>
  );
}

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
  onSetTags,
  onFilterTag,
  onNewOrchestration,
  multiSelected,
  groupKey,
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
  onRequestArchive?: (chats: Thread[]) => void;
  onOpenPr?: (threadId: string) => void;
  onMarkUnread?: (thread: Thread) => void;
  onRenameChat?: (id: string, title: string) => void;
  onCloseChat?: (thread: Thread) => void;
  onAddAgent?: (fromThreadId: string, opts: NewChatTabOptions) => void;
  onSetTags?: (tags: string[]) => void;
  onFilterTag?: (tag: string) => void;
  /** Orchestration parent +: open the create-orchestrator modal. */
  onNewOrchestration?: () => void;
  multiSelected: Set<string>;
  /** Override tab-order / last-chat key (orchestration uses the global workspace id). */
  groupKey?: string;
}) {
  const [gitCardOpen, setGitCardOpenState] = useState(false);
  const [collapsedWhileSelected, setCollapsedWhileSelected] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const tagBtnRef = useRef<HTMLButtonElement>(null);
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
  const block = worktreeAgentBlock(group);
  const expandKey = groupKey?.trim() || unreadWorktreeKey(primary);
  const nestMin = orch ? 1 : SIDEBAR_NEST_MIN_CHATS;
  const expanded = resolveSidebarChatExpanded({
    chatCount: group.length,
    selected: active,
    collapsedWhileSelected,
    minChats: nestMin,
  });
  const anchor = orch ? null : worktreeAnchorLabel(group);
  const parentTitle = orch ? worktreeLabel : (anchor?.title || worktreeLabel);
  const branchLine = !orch ? (anchor?.subtitle ?? null) : null;
  const metaLine = worktreeSidebarMeta({
    agent: primary.agent,
    chatCount: group.length,
    branch: branchLine,
    port: orch ? null : (group.find((t) => t.devPort != null)?.devPort ?? null),
    archiving,
  });
  const showChevron = active && !archiving && group.length >= nestMin;
  const showMetaRow = Boolean(metaLine) || showChevron;
  const showNewOrch = orch && Boolean(onNewOrchestration) && !archiving;
  const showAddAgent = Boolean(onAddAgent) && !orch && !archiving;
  const showWorktreeActions = showArchive || showAddAgent || showNewOrch;

  function requestArchive() {
    if (!onRequestArchive) return;
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
        }${archiving ? ' archiving' : ''}${unread ? ' unread' : ''}${
          block ? ' is-blocked' : ''
        }`}
        aria-busy={archiving}
        onMouseEnter={() => {
          if (!orch && !addOpen && !tagEditorOpen) setGitCardOpen(true);
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
            blockedReason={block?.reason}
          />
        )}
        <div className="thread-item-body">
          <div className="thread-title" title={parentTitle}>
            <span className="thread-title-text">{parentTitle}</span>
            {primary.cowboy ? <span className="board-badge">cowboy</span> : null}
            {orch ? null : (
              <WorktreePrBadges
                group={group}
                viewerLogin={githubLogin}
                reviewLabel={reviewLabel}
              />
            )}
          </div>
          {block ? (
            <div className="thread-blocked-reason" title={block.reason}>
              {block.reason}
            </div>
          ) : null}
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
        {!archiving && (showWorktreeActions || onSetTags) ? (
          <div
            className={`worktree-row-actions${addOpen || tagEditorOpen ? ' is-open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {onSetTags && !orch ? (
              <button
                ref={tagBtnRef}
                type="button"
                className="icon-btn worktree-tag-btn"
                aria-label={`Edit tags for ${parentTitle}`}
                aria-expanded={tagEditorOpen}
                title="Tags"
                onClick={() => {
                  setGitCardOpen(false);
                  setTagEditorOpen((open) => !open);
                }}
              >
                <TagIcon />
              </button>
            ) : null}
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
            {showNewOrch ? (
              <button
                type="button"
                className="icon-btn worktree-add-agent-btn"
                aria-label="Add agent"
                title="Add agent"
                onClick={() => onNewOrchestration?.()}
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
      {!orch ? (
        <>
          <WorkspaceTags
            tags={workspaceTagsFromGroup(group)}
            onFilter={onFilterTag}
            onManage={
              onSetTags
                ? () => {
                    setGitCardOpen(false);
                    setTagEditorOpen(true);
                  }
                : undefined
            }
          />
          {onSetTags ? (
            <WorkspaceTagEditor
              open={tagEditorOpen}
              tags={workspaceTagsFromGroup(group)}
              anchorRef={tagBtnRef}
              onChange={onSetTags}
              onClose={() => setTagEditorOpen(false)}
            />
          ) : null}
        </>
      ) : null}
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
