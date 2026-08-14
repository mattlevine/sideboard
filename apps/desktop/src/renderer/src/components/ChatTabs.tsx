import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentKind, Autonomy, ThinkingEffort, Thread } from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { isOrchestratorThread, threadDisplayTitle } from '../lib/global-workspace';
import { isImagePath } from '../lib/language';
import { previewUrlTabLabel } from '../lib/preview-url';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import { ContextMeter } from './ContextMeter';
import { GitChangeBadge, type GitFileChange } from './GitChangeBadge';
import { loadThreadDefaults } from '../lib/thread-defaults';

export type NewChatTabOptions = {
  agent?: AgentKind;
  model?: string | null;
  autonomy?: Autonomy;
  effort?: ThinkingEffort;
};

interface Props {
  chats: Thread[];
  activeChatId: string;
  /** Open file paths shown as tabs beside chats. */
  openFiles?: string[];
  /** When set, a file tab is active (chat content hidden). */
  activeFilePath?: string | null;
  /** Open http(s) preview URLs shown as tabs. */
  openUrls?: string[];
  /** When set, a URL preview tab is active. */
  activeUrl?: string | null;
  /** Dedicated Changes tab (not a per-file basename tab). */
  changesOpen?: boolean;
  changesActive?: boolean;
  changesCount?: number;
  /** Git change markers keyed by relative path (status letter on dirty file tabs). */
  fileChanges?: Record<string, GitFileChange>;
  /** Compact open-worktree control (replaces the old top header). */
  openMenu?: ReactNode;
  /** Left/right edge toggles for the center column. */
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
  statusBadge?: string | null;
  /** Compact thread-wide token usage total (e.g. "Σ 12.3k tok"). */
  usageTotalLabel?: string | null;
  usageTotalTooltip?: string;
  /** 0–1 context fill from the latest turn; omit to hide the meter. */
  contextRatio?: number | null;
  contextTooltip?: string;
  onSelectChat: (id: string) => void;
  onSelectFile?: (path: string, opts?: { view?: 'edit' | 'diff' }) => void;
  onCloseFile?: (path: string) => void;
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onSelectChanges?: () => void;
  onCloseChanges?: () => void;
  onNewTab: (opts?: NewChatTabOptions) => void;
  onRename: (id: string, title: string) => void;
  onCloseTab?: (id: string) => void;
}

function basename(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}

export function ChatTabs({
  chats,
  activeChatId,
  openFiles = [],
  activeFilePath = null,
  openUrls = [],
  activeUrl = null,
  changesOpen = false,
  changesActive = false,
  changesCount = 0,
  fileChanges = {},
  openMenu,
  leftSidebarToggle,
  rightSidebarToggle,
  statusBadge = null,
  usageTotalLabel = null,
  usageTotalTooltip,
  contextRatio = null,
  contextTooltip,
  onSelectChat,
  onSelectFile,
  onCloseFile,
  onSelectUrl,
  onCloseUrl,
  onSelectChanges,
  onCloseChanges,
  onNewTab,
  onRename,
  onCloseTab,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newTabDefaults, setNewTabDefaults] = useState<{
    agent: AgentKind;
    model: string | null;
    autonomy: Autonomy;
    effort: ThinkingEffort;
  }>({
    agent: 'claude',
    model: null,
    autonomy: 'default',
    effort: 'high',
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? chats[0],
    [chats, activeChatId],
  );
  const orchAgentsOnly = isOrchestratorThread(activeChat);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  async function openNewTabPicker() {
    const defaults = await loadThreadDefaults();
    let agent = defaults.agent;
    let model = defaults.model;
    if (orchAgentsOnly && !(ORCHESTRATOR_AGENT_KINDS as readonly string[]).includes(agent)) {
      agent = 'claude';
      model = null;
    }
    setNewTabDefaults({
      agent,
      model,
      autonomy: 'default',
      effort: defaults.effort,
    });
    setNewOpen(true);
  }

  function startEdit(t: Thread) {
    setEditingId(t.id);
    setDraft(threadDisplayTitle(t));
  }

  function commitEdit() {
    if (!editingId) return;
    const title = draft.trim();
    if (title && title !== chats.find((c) => c.id === editingId)?.title) {
      onRename(editingId, title);
    }
    setEditingId(null);
  }

  const urlActive = Boolean(activeUrl) && !changesActive;
  const fileActive = Boolean(activeFilePath) && !changesActive && !urlActive;

  return (
    <div className="chat-tabs">
      {leftSidebarToggle}
      <div className="chat-tabs-scroll">
        {changesOpen && (
          <div
            className={`chat-tab file-tab-item changes-tab${changesActive ? ' active' : ''}`}
            onClick={() => onSelectChanges?.()}
            title="Changes"
          >
            <span className="chat-tab-file-icon" aria-hidden>
              ±
            </span>
            <span className="chat-tab-title">Changes</span>
            {changesCount > 0 && (
              <span className="chat-tab-changes-count">{changesCount}</span>
            )}
            {onCloseChanges && (
              <button
                type="button"
                className="chat-tab-close"
                title="Close Changes"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseChanges();
                }}
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Conductor order: file tabs, URL tabs, then chat/agent tabs */}
        {openFiles.map((path) => {
          const active = fileActive && activeFilePath === path;
          const change = fileChanges[path];
          return (
            <div
              key={`file:${path}`}
              className={`chat-tab file-tab-item${active ? ' active' : ''}${change ? ' changed' : ''}`}
              onClick={() => onSelectFile?.(path)}
              title={path}
            >
              <span className="chat-tab-file-icon" aria-hidden>
                {isImagePath(path) ? '▣' : '{}'}
              </span>
              <span className="chat-tab-title">{basename(path)}</span>
              {change && <GitChangeBadge change={change} compact />}
              {onCloseFile && (
                <button
                  type="button"
                  className="chat-tab-close"
                  title="Close file"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFile(path);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {openUrls.map((url) => {
          const active = urlActive && activeUrl === url;
          return (
            <div
              key={`url:${url}`}
              className={`chat-tab file-tab-item url-tab-item${active ? ' active' : ''}`}
              onClick={() => onSelectUrl?.(url)}
              title={url}
            >
              <span className="chat-tab-file-icon" aria-hidden>
                ◎
              </span>
              <span className="chat-tab-title">{previewUrlTabLabel(url)}</span>
              {onCloseUrl && (
                <button
                  type="button"
                  className="chat-tab-close"
                  title="Close URL"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseUrl(url);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {chats.map((t) => {
          const active = !fileActive && !urlActive && !changesActive && t.id === activeChatId;
          return (
            <div
              key={t.id}
              className={`chat-tab chat-tab-agent${active ? ' active' : ''}`}
              onClick={() => onSelectChat(t.id)}
              onDoubleClick={() => startEdit(t)}
            >
              {editingId === t.id ? (
                <input
                  ref={inputRef}
                  className="chat-tab-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit();
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <>
                  <span className="chat-tab-agent-icon" aria-hidden>
                    ›_
                  </span>
                  <span className="chat-tab-title" title={t.title}>
                    {threadDisplayTitle(t)}
                  </span>
                  {active && (
                    <button
                      type="button"
                      className="chat-tab-edit"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(t);
                      }}
                    >
                      ✎
                    </button>
                  )}
                </>
              )}
              {onCloseTab && (
                <button
                  type="button"
                  className="chat-tab-close"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(t.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="chat-tab-add"
          title="New chat tab"
          onClick={() => void openNewTabPicker()}
        >
          +
        </button>
        <AgentOptionsPicker
          open={newOpen}
          value={newTabDefaults}
          title="New chat tab"
          confirmLabel="Create tab"
          allowedAgents={orchAgentsOnly ? ORCHESTRATOR_AGENT_KINDS : undefined}
          onClose={() => setNewOpen(false)}
          onApply={(next) => {
            onNewTab({
              agent: next.agent,
              model: next.model,
              autonomy: next.autonomy,
              effort: next.effort,
            });
          }}
        />
      </div>
      <div className="chat-tabs-actions">
        {(usageTotalLabel || contextRatio != null) && (
          <span className="thread-meta usage-cluster">
            {contextRatio != null && (
              <ContextMeter ratio={contextRatio} title={contextTooltip} />
            )}
            {usageTotalLabel && (
              <span className="usage-total" title={usageTotalTooltip}>
                {usageTotalLabel}
              </span>
            )}
          </span>
        )}
        {statusBadge && <span className="thread-meta status-live">{statusBadge}</span>}
        {rightSidebarToggle}
        {openMenu}
      </div>
    </div>
  );
}
