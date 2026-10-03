import { useMemo, useState, type ReactNode } from 'react';
import type { AgentKind, Autonomy, ThinkingEffort, Thread } from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { isOrchestratorThread } from '../lib/global-workspace';
import { isImagePath } from '../lib/language';
import { previewUrlTabLabel } from '../lib/preview-url';
import {
  workspaceChromeCrumbs,
  type WorkspaceChromeCrumb,
} from '../lib/workspace-chrome';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import { GitChangeBadge, type GitFileChange } from './GitChangeBadge';
import { loadOrchestratorDefaults, loadThreadDefaults } from '../lib/thread-defaults';

export type NewChatTabOptions = {
  agent?: AgentKind;
  model?: string | null;
  autonomy?: Autonomy;
  effort?: ThinkingEffort;
  fast?: boolean;
};

interface Props {
  chats: Thread[];
  activeChatId: string;
  /** Open file paths shown as tabs beside the breadcrumb. */
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
  /** Project folder shown in the titlebar crumb (`brightsy-ai`). */
  projectName?: string | null;
  /** PR title, or branch name when there is no PR. */
  taskName?: string | null;
  /** Current agent purpose name (`New agent` until the first prompt names it). */
  agentName?: string | null;
  /** Branch selector (`…`) next to the crumb. */
  branchMenu?: ReactNode;
  /** Open-worktree cube (Finder / Cursor / …) on the right. */
  openMenu?: ReactNode;
  /** Leave the thread (back to the board). */
  onBack?: () => void;
  /** Left/right edge toggles for the center column. */
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
  statusBadge?: string | null;
  /** Combined context + plan meter (one ring). */
  planUsage?: ReactNode;
  onSelectChat: (id: string) => void;
  onSelectFile?: (path: string, opts?: { view?: 'edit' | 'diff' }) => void;
  onCloseFile?: (path: string) => void;
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onSelectChanges?: () => void;
  onCloseChanges?: () => void;
  /** Native PR page tab (GitHub API), not an embedded github.com preview. */
  prPageOpen?: boolean;
  prPageActive?: boolean;
  prPageTitle?: string;
  onSelectPrPage?: () => void;
  onClosePrPage?: () => void;
  onNewTab: (opts?: NewChatTabOptions) => void;
  onFindChat?: () => void;
}

function basename(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}

function crumbClass(kind: WorkspaceChromeCrumb['kind']): string {
  if (kind === 'task') return 'open-crumb open-crumb-task';
  if (kind === 'agent') return 'open-crumb open-crumb-agent';
  return 'open-crumb';
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
  projectName = null,
  taskName = null,
  agentName = null,
  branchMenu,
  openMenu,
  onBack,
  leftSidebarToggle,
  rightSidebarToggle,
  statusBadge = null,
  planUsage = null,
  onSelectChat,
  onSelectFile,
  onCloseFile,
  onSelectUrl,
  onCloseUrl,
  onSelectChanges,
  onCloseChanges,
  prPageOpen = false,
  prPageActive = false,
  prPageTitle = 'PR',
  onSelectPrPage,
  onClosePrPage,
  onNewTab,
  onFindChat,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [newTabDefaults, setNewTabDefaults] = useState<{
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

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? chats[0],
    [chats, activeChatId],
  );
  const orchAgentsOnly = isOrchestratorThread(activeChat);
  const crumbs = workspaceChromeCrumbs({
    project: projectName ?? '',
    task: taskName,
    agent: agentName,
  });
  const crumbTitle = crumbs.map((c) => c.label).join(' > ');
  const showAuxTabs =
    prPageOpen || changesOpen || openFiles.length > 0 || openUrls.length > 0;

  const urlActive = Boolean(activeUrl) && !changesActive && !prPageActive;
  const fileActive = Boolean(activeFilePath) && !changesActive && !urlActive && !prPageActive;

  async function openNewTabPicker() {
    const defaults = orchAgentsOnly
      ? await loadOrchestratorDefaults()
      : await loadThreadDefaults();
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
      fast: defaults.fast,
    });
    setNewOpen(true);
  }

  return (
    <div className="thread-chrome">
      <div className="workspace-chrome">
        {leftSidebarToggle}
        {onBack && (
          <button
            type="button"
            className="workspace-back"
            title="Back to board"
            aria-label="Back to board"
            onClick={onBack}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M10 3 L5 8 L10 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <div className="workspace-chrome-crumb" title={crumbTitle || undefined}>
          <span className="workspace-glyph" aria-hidden />
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.kind}:${crumb.label}`} className="workspace-chrome-crumb-item">
              {i > 0 ? <span className="open-sep">{'>'}</span> : null}
              {crumb.kind === 'agent' ? (
                <button
                  type="button"
                  className={crumbClass(crumb.kind)}
                  title={crumb.label}
                  onClick={() => onSelectChat(activeChatId)}
                >
                  {crumb.label}
                </button>
              ) : (
                <span className={crumbClass(crumb.kind)}>{crumb.label}</span>
              )}
            </span>
          ))}
          {branchMenu}
          <button
            type="button"
            className="chat-tab-add"
            title="Add agent"
            aria-label="Add agent"
            onClick={() => void openNewTabPicker()}
          >
            +
          </button>
          <AgentOptionsPicker
            open={newOpen}
            value={newTabDefaults}
            title="Add agent"
            confirmLabel="Add agent"
            allowedAgents={orchAgentsOnly ? ORCHESTRATOR_AGENT_KINDS : undefined}
            onClose={() => setNewOpen(false)}
            onApply={(next) => {
              onNewTab({
                agent: next.agent,
                model: next.model,
                autonomy: next.autonomy,
                effort: next.effort,
                fast: next.fast,
              });
            }}
          />
        </div>
        <div className="workspace-chrome-actions">
          {planUsage}
          {onFindChat && (
            <button
              type="button"
              className="chat-tab-open chat-tab-find"
              title="Find in chat"
              aria-label="Find in chat"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFindChat();
              }}
            >
              <span className="nav-glyph search" aria-hidden />
            </button>
          )}
          {statusBadge && <span className="thread-meta status-live">{statusBadge}</span>}
          {openMenu}
          {rightSidebarToggle}
        </div>
      </div>
      {showAuxTabs ? (
        <div className="chat-tabs">
          <div className="chat-tabs-scroll">
            {prPageOpen && (
              <div
                className={`chat-tab file-tab-item pr-tab${prPageActive ? ' active' : ''}`}
                onClick={() => onSelectPrPage?.()}
                title={prPageTitle}
              >
                <span className="chat-tab-file-icon" aria-hidden>
                  ⎇
                </span>
                <span className="chat-tab-title">{prPageTitle}</span>
                {onClosePrPage && (
                  <button
                    type="button"
                    className="chat-tab-close"
                    title="Close PR"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClosePrPage();
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}

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
          </div>
        </div>
      ) : null}
    </div>
  );
}
