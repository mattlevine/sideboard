import { useEffect, useRef, useState } from 'react';
import { normalizePreviewUrl } from '../lib/preview-url';

interface Props {
  url: string;
  onNavigate: (url: string) => void;
  onClose: () => void;
  /** Hide the BrowserView while a modal covers the window (e.g. Settings). */
  suspended?: boolean;
}

function readBounds(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function UrlPreview({ url, onNavigate, onClose, suspended = false }: Props) {
  const [draft, setDraft] = useState(url);
  const [loadedUrl, setLoadedUrl] = useState(url);
  const hostRef = useRef<HTMLDivElement>(null);
  const suppressNavSync = useRef(false);

  useEffect(() => {
    setDraft(url);
    setLoadedUrl(url);
  }, [url]);

  useEffect(() => {
    return window.sideboard.urlPreview.onNavigated(({ url: next }) => {
      if (suppressNavSync.current) return;
      const resolved = normalizePreviewUrl(next);
      if (!resolved) return;
      setDraft(resolved);
      setLoadedUrl(resolved);
      if (resolved !== url) onNavigate(resolved);
    });
  }, [url, onNavigate]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (suspended) {
      void window.sideboard.urlPreview.hide();
      return;
    }

    const publish = () => {
      const bounds = readBounds(host);
      if (bounds.width < 2 || bounds.height < 2) {
        void window.sideboard.urlPreview.hide();
        return;
      }
      void window.sideboard.urlPreview.show({ url: loadedUrl, bounds });
    };

    publish();
    const ro = new ResizeObserver(() => {
      const bounds = readBounds(host);
      if (bounds.width < 2 || bounds.height < 2) {
        void window.sideboard.urlPreview.hide();
        return;
      }
      void window.sideboard.urlPreview.setBounds(bounds);
    });
    ro.observe(host);
    window.addEventListener('resize', publish);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', publish);
      void window.sideboard.urlPreview.hide();
    };
  }, [loadedUrl, suspended]);

  function load(next?: string) {
    const resolved = normalizePreviewUrl(next ?? draft);
    if (!resolved) return;
    suppressNavSync.current = true;
    setDraft(resolved);
    setLoadedUrl(resolved);
    void window.sideboard.urlPreview.navigate(resolved).finally(() => {
      suppressNavSync.current = false;
    });
    if (resolved !== url) onNavigate(resolved);
  }

  return (
    <div className="url-preview">
      <div className="file-path-bar">
        <form
          className="url-preview-bar"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            type="text"
            className="url-preview-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="http://localhost:3000"
            spellCheck={false}
            aria-label="Preview URL"
          />
          <button type="submit" className="primary">
            Go
          </button>
          <button
            type="button"
            title="Reload"
            onClick={() => void window.sideboard.urlPreview.reload()}
          >
            ↻
          </button>
          <button
            type="button"
            title="Open in browser"
            onClick={() => void window.sideboard.openExternal(loadedUrl)}
          >
            ↗
          </button>
          <button type="button" className="file-path-copy" title="Close" onClick={onClose}>
            ×
          </button>
        </form>
      </div>
      <div ref={hostRef} className="url-preview-frame" aria-label={`Preview ${loadedUrl}`} />
    </div>
  );
}
