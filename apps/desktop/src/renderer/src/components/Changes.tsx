import { useEffect, useState } from 'react';
import type { DiffResult } from '@sideboard/core';

interface Props {
  threadId: string;
  onAskAboutFile: (path: string) => void;
}

export function Changes({ threadId, onAskAboutFile }: Props) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.sideboard
      .getDiff(threadId)
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        setSelected(d.files[0]?.path ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (error) return <div className="empty">{error}</div>;
  if (!diff) return <div className="empty">Loading diff…</div>;
  if (!diff.files.length) {
    return (
      <div className="empty">
        No changes vs {diff.base}
        {diff.dirty ? ' (worktree dirty but no file patches)' : ''}
      </div>
    );
  }

  const file = diff.files.find((f) => f.path === selected) ?? diff.files[0]!;

  return (
    <div className="changes">
      <div className="file-list">
        <div className="section-label">Files · {diff.stat.trim()}</div>
        {diff.files.map((f) => (
          <div
            key={f.path}
            className={`file-item${f.path === file.path ? ' active' : ''}`}
            onClick={() => setSelected(f.path)}
          >
            <div>{f.path}</div>
            <div className="thread-meta">{f.status}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="actions" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => onAskAboutFile(file.path)}>Ask agent about this file</button>
        </div>
        <div className="diff-view">{file.patch || '(binary or empty patch)'}</div>
      </div>
    </div>
  );
}
