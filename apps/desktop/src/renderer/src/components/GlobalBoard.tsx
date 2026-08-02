import { useMemo, useState, type ReactNode } from 'react';
import type { OrchestratorRuntime, Thread } from '@sideboard/core';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  threads: Thread[];
  runtime: OrchestratorRuntime | null;
  selectedIds: Set<string>;
  liveByThread: Record<string, string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onOpenThread: (id: string) => void;
  onFanOut: (prompt: string) => Promise<void>;
  onStopSelected: () => Promise<void>;
  onNewThread: () => void;
  onNewCoordinator: () => void;
  onRefresh: () => void;
  /** Left-edge open control when the left sidebar is closed. */
  leftSidebarToggle?: ReactNode;
}

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
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
  selectedIds,
  liveByThread,
  onToggle,
  onSelectAll,
  onClearSelection,
  onOpenThread,
  onFanOut,
  onStopSelected,
  onNewThread,
  onNewCoordinator,
  onRefresh,
  leftSidebarToggle,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const byRepo = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      const key = t.repoPath;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) =>
      repoName(a).localeCompare(repoName(b)),
    );
  }, [threads]);

  const selectedRunning = threads.filter(
    (t) => selectedIds.has(t.id) && (t.status === 'running' || t.status === 'queued'),
  );

  async function sendFanOut() {
    const text = prompt.trim();
    if (!text || selectedIds.size === 0) return;
    setBusy(true);
    try {
      await onFanOut(text);
      setPrompt('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel board">
      {leftSidebarToggle && (
        <div className="board-chrome">
          {leftSidebarToggle}
          <div className="board-chrome-spacer" />
        </div>
      )}
      <div className="panel-header">
        <h2>Global orchestrator</h2>
        <span className="thread-meta">
          {runtime
            ? `${runtime.running}/${runtime.maxConcurrent} running · ${runtime.queued} queued · ${runtime.totalActive} threads`
            : '…'}
        </span>
        <div className="actions">
          <button onClick={onRefresh}>Refresh</button>
          <button onClick={onNewThread}>New thread</button>
          <button className="primary" onClick={onNewCoordinator}>
            New coordinator
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

      <div className="board-toolbar">
        <button
          onClick={() => onSelectAll(threads.map((t) => t.id))}
          disabled={threads.length === 0}
        >
          Select all
        </button>
        <button onClick={onClearSelection} disabled={selectedIds.size === 0}>
          Clear
        </button>
        <button
          onClick={() => void onStopSelected()}
          disabled={selectedRunning.length === 0}
        >
          Stop selected ({selectedRunning.length})
        </button>
        <span className="thread-meta" style={{ marginLeft: 'auto' }}>
          {selectedIds.size} selected — fan-out below
        </span>
      </div>

      <div className="board-body">
        {threads.length === 0 && (
          <div className="empty">
            No threads yet. Create one, or start a coordinator to spawn workers.
          </div>
        )}
        {byRepo.map(([repoPath, repoThreads]) => (
          <div key={repoPath} className="board-repo">
            <div className="board-repo-header">
              <strong>{repoName(repoPath)}</strong>
              <span className="thread-meta">{repoPath}</span>
              <button
                onClick={() => onSelectAll(repoThreads.map((t) => t.id))}
                style={{ marginLeft: 'auto' }}
              >
                Select repo
              </button>
            </div>
            <div className="board-table">
              {repoThreads.map((t) => {
                const live = liveByThread[t.id];
                const last = t.messages[t.messages.length - 1];
                const previewText =
                  live ||
                  t.lastError ||
                  (last?.role === 'agent' || last?.role === 'user' ? last.text : null) ||
                  t.sourceRef ||
                  '';
                const previewIsMarkdown = Boolean(live || (last && last.role === 'agent'));
                return (
                  <div
                    key={t.id}
                    className={`board-row${selectedIds.has(t.id) ? ' selected' : ''}${
                      t.sourceType === 'orchestration' ? ' coordinator' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => onToggle(t.id)}
                    />
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
                        {threadDisplayLabel(t)}
                        {t.sourceType === 'orchestration' ? ' · coordinator' : ''}
                      </div>
                      <div className="thread-meta">
                        {t.agent} · {t.status}
                        {t.queue.length ? ` · q${t.queue.length}` : ''}
                        {t.devPort ? ` · :${t.devPort}` : ''}
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
        ))}
      </div>

      <div className="composer board-composer">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            selectedIds.size > 0
              ? `Fan-out to ${selectedIds.size} thread${selectedIds.size === 1 ? '' : 's'}…`
              : 'Select threads above, then type a prompt to fan out…'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void sendFanOut();
            }
          }}
        />
        <button
          className="primary"
          disabled={busy || !prompt.trim() || selectedIds.size === 0}
          onClick={() => void sendFanOut()}
        >
          Fan-out
        </button>
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
