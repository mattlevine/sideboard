import { useMemo, type ReactNode } from 'react';
import type { OrchestratorRuntime, Thread } from '@sideboard-ai/core';
import {
  CLOUD_ORCHESTRATOR_GOAL,
  GLOBAL_WORKSPACE_ID,
  isCloudCoordinatorThread,
  threadDisplayTitle,
} from '../lib/global-workspace';
import { FleetActivityBar } from './FleetActivityBar';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  threads: Thread[];
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  onOpenThread: (id: string) => void;
  onNewGlobalChat: () => void;
  onRefresh: () => void;
  /** Left-edge open control when the left sidebar is closed. */
  leftSidebarToggle?: ReactNode;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function previewForThread(
  t: Thread,
  live: string | undefined,
): { text: string; markdown: boolean } {
  if (live) return { text: live, markdown: true };
  if (t.lastError) return { text: t.lastError, markdown: false };
  const last = t.messages[t.messages.length - 1];
  if (last?.role === 'agent' || last?.role === 'user') {
    return { text: last.text, markdown: last.role === 'agent' };
  }
  // Don't surface the internal Brightsy marker string as a preview.
  if (t.sourceRef?.trim() && t.sourceRef !== CLOUD_ORCHESTRATOR_GOAL) {
    return { text: t.sourceRef, markdown: false };
  }
  return { text: '', markdown: false };
}

export function GlobalBoard({
  threads,
  runtime,
  liveByThread,
  onOpenThread,
  onNewGlobalChat,
  onRefresh,
  leftSidebarToggle,
}: Props) {
  const globalChats = useMemo(
    () =>
      threads
        .filter((t) => t.repoPath === GLOBAL_WORKSPACE_ID)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );

  return (
    <section className="panel board">
      {leftSidebarToggle && (
        <div className="board-chrome">
          {leftSidebarToggle}
          <div className="board-chrome-spacer" />
        </div>
      )}
      <div className="panel-header">
        <h2>Orchestration</h2>
        <span className="thread-meta">
          {runtime
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${globalChats.length} chat${globalChats.length === 1 ? '' : 's'}`
            : '…'}
        </span>
        <div className="actions">
          <button onClick={onRefresh}>Refresh</button>
          <button onClick={onNewGlobalChat}>New chat</button>
        </div>
      </div>

      <FleetActivityBar runtime={runtime} compact />

      <p className="thread-meta board-lede">
        Chats that steer worktree agents across your registered workspaces.
        Brightsy cloud requests go to the chat marked Brightsy.
      </p>

      <div className="board-body">
        {globalChats.length === 0 && (
          <div className="empty">
            No orchestration chats yet. Create a chat to get started.
          </div>
        )}
        <div className="board-table">
          {globalChats.map((t) => {
            const { text: previewText, markdown: previewIsMarkdown } = previewForThread(
              t,
              liveByThread[t.id],
            );
            const isCloud = isCloudCoordinatorThread(t);
            return (
              <div
                key={t.id}
                className={`board-row${isCloud ? ' cloud-brightsy' : ''}`}
              >
                <span className={`dot ${t.status}`} title={t.status} />
                <div
                  className="board-open"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenThread(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenThread(t.id);
                    }
                  }}
                >
                  <div className="thread-title">
                    {threadDisplayTitle(t)}
                    {isCloud ? (
                      <span className="board-badge" title="Receives Brightsy cloud requests">
                        Brightsy
                      </span>
                    ) : null}
                  </div>
                  <div className="thread-meta">
                    {t.agent} · {t.status}
                    {t.queue.length ? ` · q${t.queue.length}` : ''}
                    {' · '}
                    {relativeTime(t.updatedAt)}
                  </div>
                  {previewText ? (
                    <div className="board-preview">
                      {previewIsMarkdown ? (
                        <MarkdownMessage
                          text={previewText}
                          className="md md-compact"
                          onThreadLinkClick={onOpenThread}
                        />
                      ) : (
                        previewText
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="board-row-actions">
                  {(t.status === 'running' || t.status === 'queued') && (
                    <button
                      onClick={() =>
                        void window.sideboard.stopThread(t.id).then(onRefresh)
                      }
                    >
                      Stop
                    </button>
                  )}
                  <button onClick={() => onOpenThread(t.id)}>Open</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
