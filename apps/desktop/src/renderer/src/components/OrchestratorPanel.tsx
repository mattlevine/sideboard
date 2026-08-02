import type { ReactNode } from 'react';
import type { MessagePart, Thread } from '@sideboard/core';
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
  onSelectChat: (id: string) => void;
  composerPrefill?: string;
  onComposerPrefillConsumed?: () => void;
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
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
}: Props) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="child-list">
        <span className="thread-meta">Child threads</span>
        {childThreads.length === 0 && <span className="thread-meta">(none yet)</span>}
        {childThreads.map((c) => (
          <button key={c.id} className="child-chip" onClick={() => onSelectChild(c.id)}>
            <span className={`dot ${c.status}`} />
            {c.title}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
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
        />
      </div>
    </div>
  );
}
