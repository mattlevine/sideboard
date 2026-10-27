import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThreadAttachment } from '@sideboard-ai/core';
import { attachmentOpenPath } from '../lib/attachment-path';

function attachmentIconLabel(kind: ThreadAttachment['kind']): string {
  switch (kind) {
    case 'issue':
      return 'ISS';
    case 'workspace':
      return 'WS';
    case 'file':
      return 'FILE';
    case 'diff-comment':
      return 'DIFF';
    case 'code-ref':
      return 'REF';
    default:
      return 'MD';
  }
}

export function ComposerAttachmentChips({
  attachments,
  onRemove,
  onOpen,
  className,
  /** When true (default for read-only chips), image thumbnails open a Mermaid-style modal. */
  expandImages,
}: {
  attachments: ThreadAttachment[];
  /** Omit for read-only chips (e.g. attachments on sent user messages). */
  onRemove?: (id: string) => void;
  /** Open a worktree file tab when a non-image chip is clicked (if resolvable). */
  onOpen?: (path: string) => void;
  className?: string;
  expandImages?: boolean;
}) {
  const removable = Boolean(onRemove);
  const imagesExpand = expandImages ?? !removable;
  const [expanded, setExpanded] = useState<{ src: string; name: string } | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => Boolean(a.previewDataUrl));
  const rest = attachments.filter((a) => !a.previewDataUrl);

  const overlay =
    expanded &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="md-image-overlay"
        role="presentation"
        onClick={() => setExpanded(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={expanded.name}
          className="md-image-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="md-image-close"
            onClick={() => setExpanded(null)}
          >
            Close
          </button>
          <div className="md-image-dialog-body">
            <img src={expanded.src} alt={expanded.name} />
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className={className ? `composer-attachments ${className}` : 'composer-attachments'}>
        {images.length > 0 && (
          <div className="composer-attachment-images">
            {images.map((a) => {
              const openPath = onOpen && !imagesExpand ? attachmentOpenPath(a) : null;
              const canExpand = imagesExpand && Boolean(a.previewDataUrl);
              const interactive = Boolean(openPath || canExpand);
              return (
                <span
                  key={a.id}
                  className={`attachment-image${interactive ? ' is-openable' : ''}`}
                  title={
                    canExpand
                      ? `Expand ${a.name}`
                      : openPath
                        ? `Open ${openPath}`
                        : a.name
                  }
                  role={interactive ? 'button' : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={() => {
                    if (canExpand && a.previewDataUrl) {
                      setExpanded({ src: a.previewDataUrl, name: a.name });
                      return;
                    }
                    if (openPath) onOpen?.(openPath);
                  }}
                  onKeyDown={(e) => {
                    if (!interactive) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (canExpand && a.previewDataUrl) {
                        setExpanded({ src: a.previewDataUrl, name: a.name });
                        return;
                      }
                      if (openPath) onOpen?.(openPath);
                    }
                  }}
                >
                  <img src={a.previewDataUrl} alt={a.name} draggable={false} />
                  {removable && (
                    <button
                      type="button"
                      className="attachment-remove"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove?.(a.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {rest.map((a) => {
          const openPath = onOpen ? attachmentOpenPath(a) : null;
          return (
            <span
              key={a.id}
              className={`attachment-chip${openPath ? ' is-openable' : ''}`}
              title={openPath ? `Open ${openPath}` : a.kind}
              role={openPath ? 'button' : undefined}
              tabIndex={openPath ? 0 : undefined}
              onClick={() => {
                if (openPath) onOpen?.(openPath);
              }}
              onKeyDown={(e) => {
                if (!openPath) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen?.(openPath);
                }
              }}
            >
              <span className={`attachment-icon kind-${a.kind}`}>
                {attachmentIconLabel(a.kind)}
              </span>
              <span className="attachment-name">{a.name}</span>
              {removable && (
                <button
                  type="button"
                  className="attachment-remove"
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove?.(a.id);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {overlay}
    </>
  );
}
