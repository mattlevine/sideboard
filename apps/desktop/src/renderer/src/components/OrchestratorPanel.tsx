import { useMemo, type ReactNode } from 'react';
import type { MessagePart, Thread } from '@sideboard-ai/core';
import { isGlobalThread } from '../lib/global-workspace';
import { ThreadPanel } from './ThreadPanel';

interface Props {
  thread: Thread;
  childThreads: Thread[];
  worktreeChats: Thread[];
  liveOutput: string;
  liveParts?: MessagePart[];
  turnStartedAt?: number;
  onRefresh: () => void;
  onSelectChild: (id: string) => void;
  onSelectChat: (id: string, created?: Thread) => void;
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
  liveOutput,
  liveParts = [],
  turnStartedAt,
  onRefresh,
  onSelectChild,
  onSelectChat,
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
        {childThreads.map((c) => (
          <button key={c.id} className="child-chip" onClick={() => onSelectChild(c.id)}>
            <span className={`dot ${c.status}`} />
            {c.title}
          </button>
        ))}
      </div>
      <div className="orchestrator-panel-main">
        <ThreadPanel
          thread={thread}
          worktreeChats={worktreeChats}
          liveOutput={liveOutput}
          liveParts={liveParts}
          turnStartedAt={turnStartedAt}
          onRefresh={onRefresh}
          onSelectChat={onSelectChat}
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
