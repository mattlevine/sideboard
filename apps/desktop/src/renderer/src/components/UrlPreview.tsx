import { useEffect, useState } from 'react';
import { normalizePreviewUrl } from '../lib/preview-url';

interface Props {
  url: string;
  onNavigate: (url: string) => void;
  onClose: () => void;
}

export function UrlPreview({ url, onNavigate, onClose }: Props) {
  const [draft, setDraft] = useState(url);
  const [loadedUrl, setLoadedUrl] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setDraft(url);
    setLoadedUrl(url);
  }, [url]);

  function load(next?: string) {
    const resolved = normalizePreviewUrl(next ?? draft);
    if (!resolved) return;
    setDraft(resolved);
    setLoadedUrl(resolved);
    setReloadKey((k) => k + 1);
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
          <button type="button" title="Reload" onClick={() => load(loadedUrl)}>
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
      <iframe
        key={`${loadedUrl}:${reloadKey}`}
        className="url-preview-frame"
        title={`Preview ${loadedUrl}`}
        src={loadedUrl}
        referrerPolicy="no-referrer"
        // allow-same-origin is required for typical localhost SPA cookies/localStorage.
        // Safe here because src is always http(s) (cross-origin to the Electron app).
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
