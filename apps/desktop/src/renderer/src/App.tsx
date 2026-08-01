import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrchestratorEvent, Thread } from '@sideboard/core';
import { Sidebar } from './components/Sidebar';
import { ThreadPanel } from './components/ThreadPanel';
import { SourcePicker } from './components/SourcePicker';
import { OrchestratorPanel } from './components/OrchestratorPanel';

export function App() {
  const [repoPath, setRepoPath] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [archived, setArchived] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [liveByThread, setLiveByThread] = useState<Record<string, string>>({});
  const [updateReady, setUpdateReady] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const all = await window.sideboard.getThreads(true);
    setThreads(all.filter((t) => t.status !== 'archived'));
    setArchived(all.filter((t) => t.status === 'archived'));
  }, []);

  useEffect(() => {
    void window.sideboard.getRepoPath().then(setRepoPath);
    void refresh();
    const offThreads = window.sideboard.onThreadsChanged(() => {
      void refresh();
    });
    const offEvents = window.sideboard.onEvent((event: OrchestratorEvent) => {
      if (event.type === 'turn_output' && event.event.type === 'stdout') {
        setLiveByThread((prev) => ({
          ...prev,
          [event.threadId]: `${prev[event.threadId] ?? ''}${event.event.data}`,
        }));
      }
      if (event.type === 'turn_started') {
        setLiveByThread((prev) => ({ ...prev, [event.threadId]: '' }));
      }
      if (
        event.type === 'turn_finished' ||
        event.type === 'status_changed' ||
        event.type === 'queue_changed' ||
        event.type === 'dev_server_started' ||
        event.type === 'dev_server_stopped' ||
        event.type === 'error'
      ) {
        void refresh();
      }
    });
    const offUpdate = window.sideboardUpdate.onReady(() => setUpdateReady(true));
    return () => {
      offThreads();
      offEvents();
      offUpdate();
    };
  }, [refresh]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? archived.find((t) => t.id === selectedId) ?? null,
    [threads, archived, selectedId],
  );

  const children = useMemo(
    () => (selected ? threads.filter((t) => t.parentThreadId === selected.id) : []),
    [threads, selected],
  );

  function onSelect(id: string, multi: boolean) {
    setSelectedId(id);
    if (!multi) {
      setMultiSelected(new Set([id]));
      return;
    }
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function fanOut() {
    const prompt = window.prompt('Prompt to fan out');
    if (!prompt) return;
    await window.sideboard.fanOut([...multiSelected], prompt);
    await refresh();
  }

  return (
    <div className="app">
      <Sidebar
        threads={threads}
        archived={archived}
        selectedId={selectedId}
        multiSelected={multiSelected}
        repoPath={repoPath}
        onSelect={onSelect}
        onNew={() => setShowPicker(true)}
        onPickRepo={() =>
          void window.sideboard.pickRepoPath().then((p) => {
            if (p) setRepoPath(p);
          })
        }
        onRestore={(id) => void window.sideboard.restoreThread(id).then(refresh)}
        onFanOut={() => void fanOut()}
      />

      {!selected && <div className="empty">Select or create a thread</div>}
      {selected && selected.sourceType === 'orchestration' && (
        <OrchestratorPanel
          thread={selected}
          childThreads={children}
          liveOutput={liveByThread[selected.id] ?? ''}
          onRefresh={() => void refresh()}
          onSelectChild={(id) => setSelectedId(id)}
          composerPrefill={prefill}
          onComposerPrefillConsumed={() => setPrefill(undefined)}
        />
      )}
      {selected && selected.sourceType !== 'orchestration' && (
        <ThreadPanel
          thread={selected}
          liveOutput={liveByThread[selected.id] ?? ''}
          onRefresh={() => void refresh()}
          composerPrefill={prefill}
          onComposerPrefillConsumed={() => setPrefill(undefined)}
        />
      )}

      {showPicker && repoPath && (
        <SourcePicker
          repoPath={repoPath}
          onClose={() => setShowPicker(false)}
          onCreated={(id) => {
            setSelectedId(id);
            void refresh();
          }}
        />
      )}

      {updateReady && (
        <div className="update-banner">
          <span>Update ready</span>
          <button className="primary" onClick={() => void window.sideboardUpdate.install()}>
            Restart to update
          </button>
        </div>
      )}
    </div>
  );
}
