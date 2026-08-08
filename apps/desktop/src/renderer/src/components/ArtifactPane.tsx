import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatArtifact } from '../lib/artifacts';
import { DocumentPreviewModeToggle } from './DocumentPreview';
import { MarkdownMessage } from './MarkdownMessage';
import { PanelResizeHandle } from './PanelResizeHandle';

const ARTIFACT_WIDTH_MIN = 320;
const ARTIFACT_WIDTH_MAX = 900;
const ARTIFACT_WIDTH_DEFAULT = 420;

interface Props {
  artifact: ChatArtifact;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  /** Fill parent tab body (no outer width/resize/close). */
  embedded?: boolean;
  /** Extra header control (e.g. maximize), shown before Code/Preview. */
  headerAction?: ReactNode;
}

function kindBadge(kind: ChatArtifact['kind']): string {
  if (kind === 'html') return 'HTML';
  if (kind === 'svg') return 'SVG';
  if (kind === 'markdown') return 'MD';
  return kind.toUpperCase();
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ArtifactPane({
  artifact,
  width = ARTIFACT_WIDTH_DEFAULT,
  onWidthChange,
  onClose,
  embedded = false,
  headerAction,
}: Props) {
  const canPreview =
    artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'markdown';
  const [mode, setMode] = useState<'code' | 'preview'>(canPreview ? 'preview' : 'code');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setMode(canPreview ? 'preview' : 'code');
  }, [artifact.id, canPreview]);

  const previewSrcDoc = useMemo(() => {
    if (artifact.kind === 'svg') {
      const trimmed = artifact.content.trim();
      if (/^<svg[\s>]/i.test(trimmed)) {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:16px;background:#fff;}</style></head><body>${trimmed}</body></html>`;
      }
    }
    return artifact.content;
  }, [artifact.content, artifact.kind]);

  // Debounce so streaming HTML doesn't constantly remount JS.
  const debouncedHtml = useDebounced(previewSrcDoc, 280);

  useEffect(() => {
    if (artifact.kind !== 'html' && artifact.kind !== 'svg') {
      setFrameUrl(null);
      setFrameError(null);
      return;
    }
    let cancelled = false;
    const id = artifact.id;
    setFrameError(null);
    void window.sideboard
      .publishArtifactPreview(id, debouncedHtml)
      .then((res) => {
        if (cancelled) return;
        // Bust cache when content changes so the iframe reloads scripts.
        setFrameUrl(`${res.url}${res.url.includes('?') ? '&' : '?'}t=${Date.now()}`);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFrameUrl(null);
        setFrameError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.id, artifact.kind, debouncedHtml]);

  // Clear preview HTML only after a real unmount. Cancel on remount so React
  // Strict Mode (and brief remounts) don't wipe the map while the pane is open —
  // otherwise Code→Preview remounts the iframe and hits "preview missing".
  useEffect(() => {
    if (clearTimerRef.current != null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    const id = artifact.id;
    return () => {
      if (clearTimerRef.current != null) {
        window.clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = window.setTimeout(() => {
        clearTimerRef.current = null;
        void window.sideboard.clearArtifactPreview(id).catch(() => {});
      }, 2_000);
    };
  }, [artifact.id]);

  const effectiveMode = canPreview ? mode : 'code';
  const isHtmlPreview =
    artifact.kind === 'html' || artifact.kind === 'svg';

  return (
    <aside
      className={`artifact-pane${embedded ? ' artifact-pane-embedded' : ''}`}
      style={embedded ? undefined : { width }}
      aria-label={`Artifact: ${artifact.title}`}
    >
      {!embedded && onWidthChange ? (
        <PanelResizeHandle
          edge="left"
          value={width}
          min={ARTIFACT_WIDTH_MIN}
          max={ARTIFACT_WIDTH_MAX}
          onChange={(w) => onWidthChange(w)}
        />
      ) : null}
      <div className="artifact-pane-header">
        <div className="artifact-pane-title-block">
          <span className="artifact-pane-kind">{kindBadge(artifact.kind)}</span>
          <h3 className="artifact-pane-title" title={artifact.title}>
            {artifact.title}
          </h3>
        </div>
        <div className="artifact-pane-actions">
          {canPreview && (
            <DocumentPreviewModeToggle mode={effectiveMode} onChange={setMode} />
          )}
          {headerAction}
          {!embedded ? (
            <button
              type="button"
              className="artifact-pane-close"
              title="Close artifact"
              aria-label="Close artifact"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="artifact-pane-body">
        {effectiveMode === 'preview' && artifact.kind === 'markdown' ? (
          <div className="artifact-pane-md">
            <MarkdownMessage text={artifact.content} className="md" />
          </div>
        ) : isHtmlPreview ? (
          <>
            {/* Keep the iframe mounted across Code/Preview toggles so we don't
                re-fetch (and don't depend on preview HTML still being in main). */}
            {frameUrl ? (
              <iframe
                className="artifact-pane-frame"
                title={artifact.title}
                hidden={effectiveMode !== 'preview'}
                // Custom protocol is isolated from the app origin; same-origin here
                // only means the artifact can use its own localStorage / etc.
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                src={frameUrl}
              />
            ) : effectiveMode === 'preview' ? (
              frameError ? (
                <div className="artifact-pane-loading">Preview failed: {frameError}</div>
              ) : (
                <div className="artifact-pane-loading">Loading preview…</div>
              )
            ) : null}
            {effectiveMode === 'code' ? (
              <pre className="artifact-pane-code">
                <code>{artifact.content}</code>
              </pre>
            ) : null}
          </>
        ) : (
          <pre className="artifact-pane-code">
            <code>{artifact.content}</code>
          </pre>
        )}
      </div>
    </aside>
  );
}

export { ARTIFACT_WIDTH_DEFAULT, ARTIFACT_WIDTH_MAX, ARTIFACT_WIDTH_MIN };
