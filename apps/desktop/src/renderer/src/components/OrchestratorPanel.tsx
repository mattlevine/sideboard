import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Thread } from '@sideboard-ai/core';
import { connectedOrchestrator } from '../lib/connected-orchestrator';
import { isGlobalThread, isOrchestratorThread } from '../lib/global-workspace';
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
  findChatCmd?: { nonce: number; query: string } | null;
  onFindChatConsumed?: () => void;
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
  /** Open another thread from a sideboard://chat/<id> markdown link. */
  onOpenThreadLink?: (threadRef: string) => void;
  openUrls?: string[];
  openUrl?: string | null;
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onNavigateUrl?: (from: string, to: string) => void;
  onShowChat?: () => void;
  urlPreviewSuspended?: boolean;
  prPageOpen?: boolean;
  onSelectPrPage?: () => void;
  onClosePrPage?: () => void;
}

/**
 * On an agent chat: the orchestration chat that lists this agent, with a
 * jump back. Hidden when this chat was not opened by an orchestrator.
 */
export function ConnectedOrchestratorBar({
  thread,
  threads,
  archived,
  onOpen,
}: {
  thread: Thread;
  threads: Thread[];
  archived: Thread[];
  onOpen: (id: string) => void;
}) {
  const inMemory = useMemo(() => {
    const byId = new Map<string, Thread>();
    for (const row of threads) byId.set(row.id, row);
    for (const row of archived) if (!byId.has(row.id)) byId.set(row.id, row);
    return connectedOrchestrator(thread, (id) => byId.get(id) ?? null);
  }, [thread, threads, archived]);

  const [fetched, setFetched] = useState<Thread | null>(null);

  useEffect(() => {
    setFetched(null);
    if (inMemory || isOrchestratorThread(thread) || !thread.parentThreadId?.trim()) return;
    let cancelled = false;
    const byId = new Map<string, Thread>();
    for (const row of threads) byId.set(row.id, row);
    for (const row of archived) if (!byId.has(row.id)) byId.set(row.id, row);
    void (async () => {
      let currentId: string | null = thread.parentThreadId;
      const seen = new Set<string>([thread.id]);
      for (let hop = 0; hop < 6 && currentId && !seen.has(currentId); hop++) {
        seen.add(currentId);
        const row =
          byId.get(currentId) ??
          (await window.sideboard.getThreadSlim(currentId).catch(() => null));
        if (!row || cancelled) return;
        byId.set(row.id, row);
        if (isOrchestratorThread(row)) {
          if (!cancelled) setFetched(row);
          return;
        }
        currentId = row.parentThreadId;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inMemory, thread, threads, archived]);

  const parent = inMemory ?? fetched;
  if (!parent) return null;
  const title = parent.title?.trim() || 'Orchestration';
  const archivedParent = parent.status === 'archived';
  return (
    <div className="child-list">
      <span className="thread-meta">Orchestrator</span>
      <button
        type="button"
        className="child-chip"
        title={archivedParent ? `${title} (archived)` : `Open ${title}`}
        onClick={() => onOpen(parent.id)}
      >
        <span className={`dot ${parent.status}`} />
        {title}
        {archivedParent ? <span className="thread-meta">archived</span> : null}
      </button>
    </div>
  );
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
  findChatCmd,
  onFindChatConsumed,
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
  prPageOpen,
  onSelectPrPage,
  onClosePrPage,
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
  const childList = (
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
  );

  return (
    <div className="panel orchestrator-panel">
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
          findChatCmd={findChatCmd}
          onFindChatConsumed={onFindChatConsumed}
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
          prPageOpen={prPageOpen}
          onSelectPrPage={onSelectPrPage}
          onClosePrPage={onClosePrPage}
          belowTabs={childList}
        />
      </div>
    </div>
  );
}
