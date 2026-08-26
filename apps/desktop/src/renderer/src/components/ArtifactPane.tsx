import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { wrapReactArtifactHtml, type ChatArtifact } from '../lib/artifacts';
import { CodeView } from './CodeView';
import { DocumentPreviewModeToggle } from './DocumentPreview';
import { MarkdownMessage } from './MarkdownMessage';
import { PanePreloader } from './PanePreloader';
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
  if (kind === 'react') return 'REACT';
  if (kind === 'log') return 'LOG';
  return kind.toUpperCase();
}

function logStatusLabel(status: ChatArtifact['status']): string {
  if (status === 'running') return 'working';
  if (status === 'ok') return 'done';
  return status ?? '';
}

const ARTIFACT_LANG_EXT: Record<string, string> = {
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  svg: 'html',
  markdown: 'md',
  md: 'md',
  mdx: 'md',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  react: 'jsx',
  log: 'log',
  console: 'log',
  python: 'py',
  py: 'py',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yaml: 'yml',
  yml: 'yml',
  shell: 'sh',
  bash: 'sh',
  sh: 'sh',
  zsh: 'sh',
};

/** Synthetic path so CodeView / Monaco can pick a language from the fence. */
function artifactCodePath(artifact: ChatArtifact): string {
  const raw = (artifact.language || artifact.kind || 'txt').toLowerCase();
  const ext = ARTIFACT_LANG_EXT[raw] ?? (/^[a-z0-9_+-]+$/.test(raw) ? raw : 'txt');
  return `artifact.${ext}`;
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
  const [frameError, setFrameError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Defer Monaco / markdown mount so the preloader can paint first. */
  const [bodyReady, setBodyReady] = useState(false);
  const clearTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setMode(canPreview ? 'preview' : 'code');
    setCopied(false);
    setBodyReady(false);
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

  // Links inside the sandboxed iframe would navigate it away (relative → white 404).
  // Main injects a guard that postMessages http(s)/mailto here for openExternal.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || data.type !== 'sideboard-artifact-open-external') return;
      if (typeof data.url !== 'string' || !data.url.trim()) return;
      void window.sideboard.openExternal(data.url.trim());
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

  useEffect(() => {
    if (artifact.kind !== 'html' && artifact.kind !== 'svg' && artifact.kind !== 'react') {
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
    artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'react';
  const isLogPreview = artifact.kind === 'log';
  const logPreRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!isLogPreview) return;
    const el = logPreRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isLogPreview, artifact.content]);
  const codePath = useMemo(() => artifactCodePath(artifact), [artifact.kind, artifact.language]);

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
      className="artifact-pane-codeview"
      path={codePath}
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
                <PanePreloader label="Loading preview" />
              )
            ) : null}
            {effectiveMode === 'code' ? codeView : null}
          </>
        ) : (
          codeView
        )}
      </div>
    </aside>
  );
}

export { ARTIFACT_WIDTH_DEFAULT, ARTIFACT_WIDTH_MAX, ARTIFACT_WIDTH_MIN };
