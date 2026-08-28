import { useMemo, type ReactNode } from 'react';
import type { Thread } from '@sideboard-ai/core';
import { isGlobalThread } from '../lib/global-workspace';
import { ThreadPanel } from './ThreadPanel';

interface Props {
  thread: Thread;
  childThreads: Thread[];
  worktreeChats: Thread[];
  onRefresh: () => void;
  onSelectChild: (id: string) => void;
  onSelectChat: (id: string, created?: Thread) => void;
  /** Leave the chat pane when the last orchestration/global tab is archived. */
  onLeaveThread?: () => void;
  composerPrefill?: string;
  onComposerPrefillConsumed?: () => void;
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
  /** Open another thread from a sideboard://thread/<id> markdown link. */
  onOpenThreadLink?: (threadRef: string) => void;
  openUrls?: string[];
  openUrl?: string | null;
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onNavigateUrl?: (from: string, to: string) => void;
  onShowChat?: () => void;
  urlPreviewSuspended?: boolean;
}

function countStatus(threads: Thread[], status: Thread['status']): number {
  return threads.filter((t) => t.status === status).length;
}

export function OrchestratorPanel({
  thread,
  childThreads,
  worktreeChats,
  onRefresh,
  onSelectChild,
  onSelectChat,
  onLeaveThread,
  composerPrefill,
  onComposerPrefillConsumed,
  leftSidebarToggle,
  rightSidebarToggle,
  onOpenThreadLink,
  openUrls,
  openUrl,
  onSelectUrl,
  onCloseUrl,
  onNavigateUrl,
  onShowChat,
  urlPreviewSuspended,
}: Props) {
  const global = isGlobalThread(thread);
  const childSummary = useMemo(() => {
    if (childThreads.length === 0) return null;
    const running = countStatus(childThreads, 'running');
    const queued = countStatus(childThreads, 'queued');
    const idle = countStatus(childThreads, 'idle');
    const error = countStatus(childThreads, 'error');
    const parts = [
      running ? `${running} running` : null,
      queued ? `${queued} queued` : null,
      idle ? `${idle} idle` : null,
      error ? `${error} error` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : `${childThreads.length} agent${childThreads.length === 1 ? '' : 's'}`;
  }, [childThreads]);

  const parentQueueCount = thread.queue.length;

  return (
    <div className="panel orchestrator-panel">
      <div className="child-list">
        <span className="thread-meta">
          {global ? 'Worktree agents' : 'Child threads'}
        </span>
        {childThreads.length === 0 ? (
          <span className="thread-meta">
            {global ? '(spawn via Sideboard MCP)' : '(none yet)'}
          </span>
        ) : (
          childSummary && <span className="thread-meta">{childSummary}</span>
        )}
        {parentQueueCount > 0 ? (
          <span
            className="thread-meta"
            title="Follow-ups waiting above the composer — edit, send now, or remove"
          >
            {parentQueueCount} queued
          </span>
        ) : null}
        {childThreads.map((c) => (
          <button key={c.id} className="child-chip" onClick={() => onSelectChild(c.id)}>
            <span className={`dot ${c.status}`} />
            {c.title}
            {c.queue.length > 0 ? (
              <span className="thread-meta" title={`${c.queue.length} queued`}>
                · q{c.queue.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="orchestrator-panel-main">
        {/* Same ThreadPanel as worktree chats — includes the Queued dock (edit / send now / remove). */}
        <ThreadPanel
          key={thread.id}
          thread={thread}
          worktreeChats={worktreeChats}
          onRefresh={onRefresh}
          onSelectChat={onSelectChat}
          onLeaveThread={onLeaveThread}
          composerPrefill={composerPrefill}
          onComposerPrefillConsumed={onComposerPrefillConsumed}
          leftSidebarToggle={leftSidebarToggle}
          rightSidebarToggle={rightSidebarToggle}
          onOpenThreadLink={onOpenThreadLink ?? onSelectChild}
          openUrls={openUrls}
          openUrl={openUrl}
          onSelectUrl={onSelectUrl}
          onCloseUrl={onCloseUrl}
          onNavigateUrl={onNavigateUrl}
          onShowChat={onShowChat}
          urlPreviewSuspended={urlPreviewSuspended}
        />
      </div>
    </div>
  );
}
