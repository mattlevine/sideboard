import type { Thread } from '@sideboard/core';

interface Props {
  threads: Thread[];
  archived: Thread[];
  selectedId: string | null;
  multiSelected: Set<string>;
  repoPath: string;
  onSelect: (id: string, multi: boolean) => void;
  onNew: () => void;
  onPickRepo: () => void;
  onRestore: (id: string) => void;
  onFanOut: () => void;
}

export function Sidebar({
  threads,
  archived,
  selectedId,
  multiSelected,
  repoPath,
  onSelect,
  onNew,
  onPickRepo,
  onRestore,
  onFanOut,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">Sideboard</div>
        <div className="repo-row">
          <span className="repo-path" title={repoPath}>
            {repoPath}
          </span>
          <button onClick={onPickRepo}>Repo</button>
        </div>
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="primary" onClick={onNew} style={{ flex: 1 }}>
            New thread
          </button>
          {multiSelected.size > 1 && (
            <button onClick={onFanOut}>Fan-out ({multiSelected.size})</button>
          )}
        </div>
      </div>

      <div className="thread-list">
        <div className="section-label">Threads</div>
        {threads.length === 0 && <div className="empty">No active threads</div>}
        {threads.map((t) => (
          <div
            key={t.id}
            className={`thread-item${selectedId === t.id ? ' active' : ''}${
              multiSelected.has(t.id) ? ' selected' : ''
            }`}
            onClick={(e) => onSelect(t.id, e.metaKey || e.ctrlKey || e.shiftKey)}
          >
            <span className={`dot ${t.status}`} />
            <div>
              <div className="thread-title">{t.title}</div>
              <div className="thread-meta">
                {t.agent} · {t.sourceType}:{t.sourceRef}
                {t.devPort ? ` · :${t.devPort}` : ''}
              </div>
            </div>
            <span className="thread-meta">{t.status}</span>
          </div>
        ))}

        {archived.length > 0 && (
          <>
            <div className="section-label">History</div>
            {archived.map((t) => (
              <div key={t.id} className="thread-item" onClick={() => onSelect(t.id, false)}>
                <span className="dot archived" />
                <div>
                  <div className="thread-title">{t.title}</div>
                  <div className="thread-meta">archived · {t.agent}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(t.id);
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
