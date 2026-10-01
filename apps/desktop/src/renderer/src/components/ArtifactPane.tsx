import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { wrapReactArtifactHtml, type ChatArtifact } from '../lib/artifacts';
import {
  artifactPreviewUrlsMatch,
  cancelArtifactPreviewClear,
  scheduleArtifactPreviewClear,
} from '../lib/artifact-preview-clear';
import { artifactSourcePath, resolveCodeLanguage } from '../lib/language';
import { CodeView } from './CodeView';
import { DocumentPreviewModeToggle } from './DocumentPreview';
import { MarkdownMessage } from './MarkdownMessage';
import { PanePreloader } from './PanePreloader';
import { PanelResizeHandle } from './PanelResizeHandle';

const ARTIFACT_WIDTH_MIN = 320;
const ARTIFACT_WIDTH_MAX = 900;
const ARTIFACT_WIDTH_DEFAULT = 420;

/** Keep in sync with `artifact-nav-guard.ts` (renderer cannot import main). */
const ARTIFACT_OPEN_EXTERNAL_MSG = 'sideboard-artifact-open-external';
const ARTIFACT_READY_MSG = 'sideboard-artifact-ready';
const ARTIFACT_MISSING_MSG = 'sideboard-artifact-missing';
const ARTIFACT_MISSING_RETRIES = 3;

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
  if (kind === 'react') return 'REACT';
  if (kind === 'log') return 'LOG';
  return kind.toUpperCase();
}

function logStatusLabel(status: ChatArtifact['status']): string {
  if (status === 'running') return 'working';
  if (status === 'ok') return 'done';
  return status ?? '';
}

/** Synthetic path so CodeView / Monaco can pick a language from the fence. */
function artifactCodePath(artifact: ChatArtifact): string {
  return artifactSourcePath(artifact.language || artifact.kind || '', artifact.content);
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
    artifact.kind === 'html' ||
    artifact.kind === 'svg' ||
    artifact.kind === 'markdown' ||
    artifact.kind === 'react' ||
    artifact.kind === 'log';
  const [mode, setMode] = useState<'code' | 'preview'>(canPreview ? 'preview' : 'code');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  /** Last iframe URL that posted `ready` — keep showing it while the next rev loads. */
  const [shownFrameUrl, setShownFrameUrl] = useState<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Defer Monaco / markdown mount so the preloader can paint first. */
  const [bodyReady, setBodyReady] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const missingRetriesRef = useRef(0);
  const frameUrlRef = useRef<string | null>(null);
  const shownFrameUrlRef = useRef<string | null>(null);
  const artifactIdRef = useRef(artifact.id);
  const debouncedHtmlRef = useRef('');

  useEffect(() => {
    setMode(canPreview ? 'preview' : 'code');
    setCopied(false);
    setBodyReady(false);
    setShownFrameUrl(null);
    setFrameUrl(null);
    setFrameError(null);
    missingRetriesRef.current = 0;
    if (copiedTimerRef.current != null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }, [artifact.id, canPreview]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current != null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // Links inside the sandboxed iframe would navigate it away (relative → 404).
  // Main injects a guard that postMessages http(s)/mailto here for openExternal.
  // Ready/missing pings keep the pane on a loader until a real document paints.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === ARTIFACT_OPEN_EXTERNAL_MSG) {
        if (typeof data.url !== 'string' || !data.url.trim()) return;
        void window.sideboard.openExternal(data.url.trim());
        return;
      }
      if (data.type === ARTIFACT_READY_MSG) {
        if (typeof data.url !== 'string') return;
        const published = frameUrlRef.current;
        if (published && artifactPreviewUrlsMatch(published, data.url)) {
          missingRetriesRef.current = 0;
          setFrameError(null);
          setShownFrameUrl(published);
        }
        return;
      }
      if (data.type !== ARTIFACT_MISSING_MSG) return;
      if (missingRetriesRef.current >= ARTIFACT_MISSING_RETRIES) {
        if (!shownFrameUrlRef.current) setFrameError('Preview failed to load');
        return;
      }
      missingRetriesRef.current += 1;
      const id = artifactIdRef.current;
      void window.sideboard
        .publishArtifactPreview(id, debouncedHtmlRef.current)
        .then((res: { url: string }) => {
          if (artifactIdRef.current !== id) return;
          setFrameUrl(res.url);
        })
        .catch((err: unknown) => {
          if (artifactIdRef.current !== id) return;
          setFrameUrl(null);
          setFrameError(err instanceof Error ? err.message : String(err));
        });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function copyContent() {
    void navigator.clipboard?.writeText(artifact.content).then(() => {
      setCopied(true);
      if (copiedTimerRef.current != null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1200);
    });
  }

  const previewSrcDoc = useMemo(() => {
    if (artifact.kind === 'svg') {
      const trimmed = artifact.content.trim();
      if (/^<svg[\s>]/i.test(trimmed)) {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:16px;background:#fff;}</style></head><body>${trimmed}</body></html>`;
      }
    }
    if (artifact.kind === 'react') {
      return wrapReactArtifactHtml(artifact.content);
    }
    return artifact.content;
  }, [artifact.content, artifact.kind]);

  // Debounce so streaming HTML doesn't constantly remount JS.
  const debouncedHtml = useDebounced(previewSrcDoc, 280);
  debouncedHtmlRef.current = debouncedHtml;
  frameUrlRef.current = frameUrl;
  shownFrameUrlRef.current = shownFrameUrl;
  artifactIdRef.current = artifact.id;

  useEffect(() => {
    if (artifact.kind !== 'html' && artifact.kind !== 'svg' && artifact.kind !== 'react') {
      setFrameUrl(null);
      setShownFrameUrl(null);
      setFrameError(null);
      return;
    }
    let cancelled = false;
    const id = artifact.id;
    setFrameError(null);
    void window.sideboard
      .publishArtifactPreview(id, debouncedHtml)
      .then((res: { url: string }) => {
        if (cancelled) return;
        setFrameUrl(res.url);
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

  // Clear preview HTML only after a real unmount. Timer is keyed by artifact id
  // so React Strict Mode remounts cancel the previous instance's delete —
  // a per-component ref left the map empty and the iframe on "preview missing".
  useEffect(() => {
    cancelArtifactPreviewClear(artifact.id);
    const id = artifact.id;
    return () => {
      scheduleArtifactPreviewClear(id, (clearId) => {
        void window.sideboard.clearArtifactPreview(clearId).catch(() => {});
      });
    };
  }, [artifact.id]);

  const effectiveMode = canPreview ? mode : 'code';
  const isHtmlPreview =
    artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'react';
  const isLogPreview = artifact.kind === 'log';
  const logPreRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!isLogPreview) return;
    const el = logPreRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isLogPreview, artifact.content]);
  const codePath = useMemo(() => artifactCodePath(artifact), [artifact.content, artifact.kind, artifact.language]);
  const codeLanguage = useMemo(
    () => resolveCodeLanguage(artifact.language || artifact.kind || '', artifact.content),
    [artifact.content, artifact.kind, artifact.language],
  );

  // Let the preloader paint before mounting Monaco / markdown.
  useEffect(() => {
    if (effectiveMode === 'preview' && isHtmlPreview) {
      // HTML/SVG preview has its own frameUrl loading state.
      setBodyReady(true);
      return;
    }
    setBodyReady(false);
    let cancelled = false;
    const raf = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (!cancelled) setBodyReady(true);
      }, 0);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [effectiveMode, isHtmlPreview, artifact.id]);

  const codeView = bodyReady ? (
    <CodeView
      className="artifact-pane-codeview code-view"
      path={codePath}
      language={codeLanguage}
      value={artifact.content}
      readOnly
      modelNonce={`artifact-${artifact.id}`}
      height="100%"
    />
  ) : (
    <PanePreloader label="Loading code" />
  );

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
          {artifact.kind === 'log' && artifact.status ? (
            <span className={`artifact-pane-log-pill ${artifact.status}`}>
              {logStatusLabel(artifact.status)}
            </span>
          ) : null}
          <h3 className="artifact-pane-title" title={artifact.title}>
            {artifact.title}
          </h3>
        </div>
        <div className="artifact-pane-actions">
          {canPreview && (
            <DocumentPreviewModeToggle mode={effectiveMode} onChange={setMode} />
          )}
          <button
            type="button"
            className="artifact-pane-copy"
            title={copied ? 'Copied' : 'Copy code'}
            aria-label={copied ? 'Copied' : 'Copy code to clipboard'}
            onClick={copyContent}
          >
            {copied ? '✓' : '⧉'}
          </button>
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
        {effectiveMode === 'preview' && artifact.kind === 'log' ? (
          <div className="artifact-pane-log-wrap">
            {artifact.phase ? (
              <div className="artifact-pane-log-phase">{artifact.phase}</div>
            ) : null}
            <pre ref={logPreRef} className="artifact-pane-log">
              {artifact.content || '(no output yet)'}
            </pre>
          </div>
        ) : effectiveMode === 'preview' && artifact.kind === 'markdown' ? (
          bodyReady ? (
            <div className="artifact-pane-md">
              <MarkdownMessage text={artifact.content} className="md" />
            </div>
          ) : (
            <PanePreloader label="Loading preview" />
          )
        ) : isHtmlPreview ? (
          <div className="artifact-pane-preview-stack">
            {/* Keep iframes mounted across Code/Preview so we don't re-fetch.
                Hide until `ready`; keep the last ready frame while the next rev loads. */}
            {effectiveMode === 'preview' && !shownFrameUrl ? (
              frameError ? (
                <div className="artifact-pane-loading">Preview failed: {frameError}</div>
              ) : (
                <PanePreloader label="Loading preview" />
              )
            ) : null}
            {shownFrameUrl && shownFrameUrl !== frameUrl ? (
              <iframe
                key={shownFrameUrl}
                className="artifact-pane-frame"
                title={artifact.title}
                hidden={effectiveMode !== 'preview'}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                src={shownFrameUrl}
              />
            ) : null}
            {frameUrl ? (
              <iframe
                key={frameUrl}
                className={
                  shownFrameUrl === frameUrl
                    ? 'artifact-pane-frame'
                    : 'artifact-pane-frame artifact-pane-frame-pending'
                }
                title={artifact.title}
                hidden={shownFrameUrl === frameUrl && effectiveMode !== 'preview'}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                src={frameUrl}
              />
            ) : null}
            {effectiveMode === 'code' ? codeView : null}
          </div>
        ) : (
          codeView
        )}
      </div>
    </aside>
  );
}

export { ARTIFACT_WIDTH_DEFAULT, ARTIFACT_WIDTH_MAX, ARTIFACT_WIDTH_MIN };
