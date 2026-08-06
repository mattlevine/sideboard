import type { ReactNode } from 'react';
import type { MessagePart, Thread } from '@sideboard/core';
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
  const global = isGlobalThread(thread);

  return (
    <div className="panel orchestrator-panel">
      <div className="child-list">
        <span className="thread-meta">
          {global ? 'Worktree agents' : 'Child threads'}
        </span>
        {childThreads.length === 0 && (
          <span className="thread-meta">
            {global ? '(spawn via Sideboard MCP)' : '(none yet)'}
          </span>
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
        />
      </div>
    </div>
  );
}
