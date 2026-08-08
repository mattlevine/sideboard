import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface MarkdownImageProps {
  src: string;
  alt?: string;
  title?: string;
  className?: string;
}

/**
 * Markdown image with Mermaid-style expand / fullscreen overlay.
 */
export function MarkdownImage({ src, alt = '', title, className }: MarkdownImageProps) {
  const [expanded, setExpanded] = useState(false);
  const label = alt.trim() || 'Image';

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (!src) {
    return null;
  }

  const image = (
    <img src={src} alt={alt} title={title} className={className} loading="lazy" />
  );

  const overlay =
    expanded &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="md-image-overlay"
        role="presentation"
        onClick={() => setExpanded(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="md-image-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="md-image-close"
            onClick={() => setExpanded(false)}
          >
            Close
          </button>
          <div className="md-image-dialog-body">{image}</div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      {!expanded ? (
        <span className="md-image">
          <button
            type="button"
            className="md-image-expand"
            aria-label={`Expand ${label}`}
            title="Expand image"
            onClick={() => setExpanded(true)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
              />
            </svg>
          </button>
          {image}
        </span>
      ) : null}
      {overlay}
    </>
  );
}

export default MarkdownImage;
