import { useEffect, useMemo, useState } from 'react';
import type { FilePathLink } from '../lib/file-path-link';

interface Props {
  threadId: string;
  link: FilePathLink;
  onClose: () => void;
  onOpenInTab: (path: string) => void;
}

export function FileReferenceModal({ threadId, link, onClose, onOpenInTab }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    setBinary(false);
    void window.sideboard
      .readFile(threadId, link.path)
      .then((r) => {
        if (cancelled) return;
        setBinary(r.binary);
        setContent(r.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, link.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preview = useMemo(() => {
    if (content == null) return null;
    if (link.startLine != null) {
      const lines = content.split('\n');
      const start = Math.max(0, link.startLine - 1);
      const end =
        link.endLine != null ? Math.min(lines.length, link.endLine) : Math.min(lines.length, start + 1);
      return lines.slice(start, end).join('\n');
    }
    const maxLines = 48;
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return `${lines.slice(0, maxLines).join('\n')}\n…`;
  }, [content, link.endLine, link.startLine]);

  const lineLabel =
    link.startLine != null
      ? link.endLine != null && link.endLine !== link.startLine
        ? `Lines ${link.startLine}–${link.endLine}`
        : `Line ${link.startLine}`
      : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal file-ref-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-ref-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="file-ref-header">
          <div className="file-ref-title-wrap">
            <h3 id="file-ref-title">{link.path}</h3>
            {lineLabel && <span className="thread-meta">{lineLabel}</span>}
          </div>
          <div className="file-ref-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                onOpenInTab(link.path);
                onClose();
              }}
            >
              Open in tab
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {error && <p className="file-ref-error">{error}</p>}
        {!error && content == null && <div className="empty">Loading…</div>}
        {!error && preview != null && (
          <pre className="file-ref-preview">{binary ? '(Binary file — open in tab to view)' : preview}</pre>
        )}
      </div>
    </div>
  );
}
