import { useEffect, useState } from 'react';
import type { FilePathLink } from '../lib/file-path-link';
import { documentPreviewKind } from '../lib/language';
import { CodeView } from './CodeView';
import { DocumentPreview, DocumentPreviewModeToggle } from './DocumentPreview';

interface Props {
  threadId: string;
  link: FilePathLink;
  worktreePath?: string;
  onClose: () => void;
  onOpenInTab: (path: string) => void;
}

export function FileReferenceModal({
  threadId,
  link,
  worktreePath,
  onClose,
  onOpenInTab,
}: Props) {
  const previewKind = documentPreviewKind(link.path);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [mode, setMode] = useState<'code' | 'preview'>('code');

  useEffect(() => {
    // Line links open in Code so the highlight is visible; otherwise prefer Preview.
    const kind = documentPreviewKind(link.path);
    setMode(kind && link.startLine == null ? 'preview' : 'code');
  }, [link.path, link.startLine]);

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
            {previewKind && !binary && (
              <DocumentPreviewModeToggle mode={mode} onChange={setMode} />
            )}
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
        {!error && content != null && binary && (
          <pre className="file-ref-preview">(Binary file — open in tab to view)</pre>
        )}
        {!error && content != null && !binary && mode === 'preview' && previewKind && (
          <div className="file-ref-code">
            <DocumentPreview path={link.path} content={content} />
          </div>
        )}
        {!error && content != null && !binary && (mode === 'code' || !previewKind) && (
          <div className="file-ref-code">
            <CodeView
              key={`preview:${link.path}`}
              path={link.path}
              value={content}
              worktreePath={worktreePath}
              modelNonce="file-ref-modal"
              readOnly
              revealLine={link.startLine}
              highlightEndLine={link.endLine}
            />
          </div>
        )}
      </div>
    </div>
  );
}
