import type { Thread } from '@sideboard/core';
import { ThreadPanel } from './ThreadPanel';

interface Props {
  thread: Thread;
  childThreads: Thread[];
  liveOutput: string;
  onRefresh: () => void;
  onSelectChild: (id: string) => void;
  composerPrefill?: string;
  onComposerPrefillConsumed?: () => void;
}

export function OrchestratorPanel({
  thread,
  childThreads,
  liveOutput,
  onRefresh,
  onSelectChild,
  composerPrefill,
  onComposerPrefillConsumed,
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
          liveOutput={liveOutput}
          onRefresh={onRefresh}
          composerPrefill={composerPrefill}
          onComposerPrefillConsumed={onComposerPrefillConsumed}
        />
      </div>
    </div>
  );
}
