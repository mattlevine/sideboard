import { lazy, Suspense, useEffect, useState } from 'react';
import type { ThreadAttachment } from '@sideboard-ai/core';
import { buildCodeRefAttachment } from '@sideboard/code-ref';
import type { FilePathLink } from '../lib/file-path-link';
import { detectLanguage, documentPreviewKind } from '../lib/language';
import { DocumentPreview, DocumentPreviewModeToggle } from './DocumentPreview';

const CodeView = lazy(() =>
  import('./CodeView').then((m) => ({ default: m.CodeView })),
);

interface Props {
  threadId: string;
  link: FilePathLink;
  worktreePath?: string;
  onClose: () => void;
  onOpenInTab: (path: string) => void;
  onCodeReference?: (attachment: ThreadAttachment) => void;
}

export function FileReferenceModal({
  threadId,
  link,
  worktreePath,
  onClose,
  onOpenInTab,
  onCodeReference,
}: Props) {
  const previewKind = documentPreviewKind(link.path);
  const isImage = previewKind === 'image';
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [encoding, setEncoding] = useState<'utf8' | 'base64'>('utf8');
  const [mode, setMode] = useState<'code' | 'preview'>('code');

  useEffect(() => {
    // Images and docs without a line range open in Preview; line links stay in Code.
    const kind = documentPreviewKind(link.path);
    if (kind === 'image') {
      setMode('preview');
      return;
    }
    setMode(kind && link.startLine == null ? 'preview' : 'code');
  }, [link.path, link.startLine]);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    setBinary(false);
    setEncoding('utf8');
    void window.sideboard
      .readFile(threadId, link.path)
      .then((r) => {
        if (cancelled) return;
        setBinary(r.binary);
        setEncoding(r.encoding ?? 'utf8');
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

  const showImage = isImage && content != null && !error;
  const showPreview =
    !error && content != null && !isImage && !binary && mode === 'preview' && previewKind;
  const showCode =
    !error && content != null && !isImage && !binary && (mode === 'code' || !previewKind);

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
            {previewKind && !isImage && !binary && (
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
        {!error && content != null && binary && !isImage && (
          <pre className="file-ref-preview">(Binary file — open in tab to view)</pre>
        )}
        {showImage && (
          <div className="file-ref-code">
            <DocumentPreview path={link.path} content={content!} encoding={encoding} />
          </div>
        )}
        {showPreview && (
          <div className="file-ref-code">
            <DocumentPreview path={link.path} content={content!} />
          </div>
        )}
        {showCode && (
          <div className="file-ref-code">
            <Suspense fallback={<div className="empty">Loading…</div>}>
              <CodeView
                key={`preview:${link.path}`}
                path={link.path}
                value={content!}
                worktreePath={worktreePath}
                modelNonce="file-ref-modal"
                readOnly
                revealLine={link.startLine}
                highlightEndLine={link.endLine}
                onAddReference={
                  onCodeReference
                    ? (sel) => {
                        onCodeReference(
                          buildCodeRefAttachment({
                            path: link.path,
                            startLine: sel.startLine,
                            endLine: sel.endLine,
                            text: sel.text,
                            language: detectLanguage(link.path),
                          }),
                        );
                      }
                    : undefined
                }
              />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
