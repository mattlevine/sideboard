import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentKind, Thread } from '@sideboard/core';
import { threadDisplayTitle } from '../lib/global-workspace';
import { FloatingMenu } from './FloatingMenu';
import { GitChangeBadge, type GitFileChange } from './GitChangeBadge';

interface Props {
  chats: Thread[];
  activeChatId: string;
  /** Open file paths shown as tabs beside chats. */
  openFiles?: string[];
  /** When set, a file tab is active (chat content hidden). */
  activeFilePath?: string | null;
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
  onSelectChat: (id: string) => void;
  onSelectFile?: (path: string, opts?: { view?: 'edit' | 'diff' }) => void;
  onCloseFile?: (path: string) => void;
  onSelectChanges?: () => void;
  onCloseChanges?: () => void;
  onNewTab: (agent?: AgentKind) => void;
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
  onSelectChat,
  onSelectFile,
  onCloseFile,
  onSelectChanges,
  onCloseChanges,
  onNewTab,
  onRename,
  onCloseTab,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

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

  const fileActive = Boolean(activeFilePath) && !changesActive;

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

        {/* Conductor order: file tabs, then chat/agent tabs */}
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
                {'{}'}
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

        {chats.map((t) => {
          const active = !fileActive && !changesActive && t.id === activeChatId;
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
              {onCloseTab && chats.length > 1 && (
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
          ref={addBtnRef}
          type="button"
          className="chat-tab-add"
          title="New chat tab"
          onClick={() => setNewOpen((v) => !v)}
        >
          +
        </button>
        <FloatingMenu
          open={newOpen}
          onClose={() => setNewOpen(false)}
          anchorRef={addBtnRef}
          align="left"
          minWidth={180}
        >
          <div className="menu-section">New tab with agent</div>
          {(
            [
              { id: 'claude' as const, label: 'Claude' },
              { id: 'codex' as const, label: 'Codex' },
              { id: 'opencode' as const, label: 'OpenCode' },
              { id: 'cursor' as const, label: 'Cursor' },
              { id: 'brightsy' as const, label: 'Brightsy' },
            ] as const
          ).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setNewOpen(false);
                onNewTab(a.id);
              }}
            >
              <span>{a.label}</span>
            </button>
          ))}
        </FloatingMenu>
      </div>
      <div className="chat-tabs-actions">
        {usageTotalLabel && (
          <span className="thread-meta usage-total" title={usageTotalTooltip}>
            {usageTotalLabel}
          </span>
        )}
        {statusBadge && <span className="thread-meta status-live">{statusBadge}</span>}
        {rightSidebarToggle}
        {openMenu}
      </div>
    </div>
  );
}
