import { useMemo, type ReactNode } from 'react';
import type { OrchestratorRuntime, Thread } from '@sideboard/core';
import {
  CLOUD_ORCHESTRATOR_GOAL,
  GLOBAL_WORKSPACE_ID,
  isCloudCoordinatorThread,
  threadDisplayTitle,
} from '../lib/global-workspace';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  threads: Thread[];
  runtime: OrchestratorRuntime | null;
  liveByThread: Record<string, string>;
  onOpenThread: (id: string) => void;
  onOpenCloudCoordinator: () => Promise<void>;
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

export function GlobalBoard({
  threads,
  runtime,
  liveByThread,
  onOpenThread,
  onOpenCloudCoordinator,
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

  const cloudCoordinator = globalChats.find(isCloudCoordinatorThread) ?? null;

  return (
    <section className="panel board">
      {leftSidebarToggle && (
        <div className="board-chrome">
          {leftSidebarToggle}
          <div className="board-chrome-spacer" />
        </div>
      )}
      <div className="panel-header">
        <h2>Global</h2>
        <span className="thread-meta">
          {runtime
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${globalChats.length} global chat${globalChats.length === 1 ? '' : 's'}`
            : '…'}
        </span>
        <div className="actions">
          <button onClick={onRefresh}>Refresh</button>
          <button onClick={onNewGlobalChat}>New chat</button>
          <button
            className="primary"
            onClick={() => void onOpenCloudCoordinator()}
          >
            {cloudCoordinator ? 'Open cloud coordinator' : 'Start cloud coordinator'}
          </button>
        </div>
      </div>

      <div className="board-stats">
        <Stat label="Running" value={runtime?.running ?? 0} tone="warn" />
        <Stat label="Queued" value={runtime?.queued ?? 0} tone="warn" />
        <Stat label="Idle" value={runtime?.idle ?? 0} tone="ok" />
        <Stat label="Error" value={runtime?.error ?? 0} tone="err" />
        <Stat label="Cap" value={runtime?.maxConcurrent ?? 3} />
      </div>

      <p className="thread-meta" style={{ padding: '0 16px 8px' }}>
        Fleet controller chats — orchestrate worktree agents via Sideboard MCP.
        Brightsy cloud always uses{' '}
        <strong>{CLOUD_ORCHESTRATOR_GOAL}</strong>.
      </p>

      <div className="board-body">
        {globalChats.length === 0 && (
          <div className="empty">
            No global chats yet. Start the cloud coordinator or create a new chat.
          </div>
        )}
        <div className="board-table">
          {globalChats.map((t) => {
            const live = liveByThread[t.id];
            const last = t.messages[t.messages.length - 1];
            const previewText =
              live ||
              t.lastError ||
              (last?.role === 'agent' || last?.role === 'user' ? last.text : null) ||
              t.sourceRef ||
              '';
            const previewIsMarkdown = Boolean(live || (last && last.role === 'agent'));
            const isCloud = isCloudCoordinatorThread(t);
            return (
              <div
                key={t.id}
                className={`board-row coordinator${isCloud ? ' cloud-coordinator' : ''}`}
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
                  <div className="thread-title">{threadDisplayTitle(t)}</div>
                  <div className="thread-meta">
                    {t.agent} · {t.status}
                    {t.queue.length ? ` · q${t.queue.length}` : ''}
                    {' · '}
                    {relativeTime(t.updatedAt)}
                  </div>
                  {previewText ? (
                    <div className="board-preview">
                      {previewIsMarkdown ? (
                        <MarkdownMessage text={previewText} className="md md-compact" />
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'err';
}) {
  return (
    <div className={`board-stat${tone ? ` ${tone}` : ''}`}>
      <div className="board-stat-value">{value}</div>
      <div className="thread-meta">{label}</div>
    </div>
  );
}
