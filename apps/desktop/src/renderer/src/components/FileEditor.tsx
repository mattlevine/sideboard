import { useCallback, useEffect, useRef, useState } from 'react';
import { documentPreviewKind } from '../lib/language';
import { CodeView } from './CodeView';
import { DocumentPreview, DocumentPreviewModeToggle } from './DocumentPreview';

interface Props {
  threadId: string;
  path: string;
  worktreePath: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditor({ threadId, path, worktreePath, onClose, onSaved }: Props) {
  const previewKind = documentPreviewKind(path);
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diskNewer, setDiskNewer] = useState(false);
  const [mode, setMode] = useState<'code' | 'preview'>('code');

  useEffect(() => {
    setMode('code');
  }, [path]);

  const dirty = content != null && content !== saved && !binary && !truncated;
  const dirtyRef = useRef(dirty);
  const contentRef = useRef(content);
  dirtyRef.current = dirty;
  contentRef.current = content;

  const applyDiskRead = useCallback(
    (r: { content: string; truncated: boolean; binary: boolean }, force: boolean) => {
      if (!force && dirtyRef.current) {
        if (r.content !== contentRef.current) setDiskNewer(true);
        return;
      }
      setBinary(r.binary);
      setTruncated(r.truncated);
      setContent(r.content);
      setSaved(r.content);
      setDiskNewer(false);
      setError(null);
    },
    [],
  );

  const loadFromDisk = useCallback(
    async (force = false) => {
      try {
        const r = await window.sideboard.readFile(threadId, path);
        applyDiskRead(r, force);
      } catch (err: unknown) {
        if (!dirtyRef.current || force) {
          setError(err instanceof Error ? err.message : String(err));
          setContent(null);
        } else {
          setDiskNewer(true);
        }
      }
    },
    [applyDiskRead, path, threadId],
  );

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    setBinary(false);
    setTruncated(false);
    setDiskNewer(false);
    void window.sideboard
      .readFile(threadId, path)
      .then((r) => {
        if (cancelled) return;
        applyDiskRead(r, true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [applyDiskRead, threadId, path]);

  useEffect(() => {
    void window.sideboard.watchOpenFile(threadId, path).catch(() => undefined);
    return () => {
      void window.sideboard.unwatchOpenFile().catch(() => undefined);
    };
  }, [threadId, path]);

  useEffect(() => {
    return window.sideboard.onOpenFileChanged((payload) => {
      if (payload.threadRef !== threadId || payload.path !== path) return;
      void loadFromDisk(false);
    });
  }, [loadFromDisk, path, threadId]);

  const save = useCallback(async () => {
    if (content == null || binary || truncated || saving) return;
    setSaving(true);
    try {
      await window.sideboard.writeFile(threadId, path, content);
      setSaved(content);
      setDiskNewer(false);
      onSaved?.();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [binary, content, onSaved, path, saving, threadId, truncated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (!dirty) return;
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, save]);

  function openExternally() {
    void window.sideboard.openInEditor(threadId, undefined, path).catch(alert);
  }

  function copyPath() {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="file-editor">
      <div className="file-path-bar">
        <button
          type="button"
          className="file-path-pill"
          title="Open in external editor"
          onClick={openExternally}
        >
          <span className="file-path-cube" aria-hidden />
          <span className="file-path-text">
            {dirty ? '● ' : ''}
            {path}
          </span>
        </button>
        <div className="file-editor-actions">
          {previewKind && !binary && (
            <DocumentPreviewModeToggle mode={mode} onChange={setMode} />
          )}
          {(binary || truncated) && (
            <span className="thread-meta">
              {binary ? 'Binary — view only' : 'Truncated — view only'}
            </span>
          )}
          {dirty && (
            <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save ⌘S'}
            </button>
          )}
          <button
            type="button"
            className="file-path-copy"
            title={copied ? 'Copied' : 'Copy path'}
            onClick={copyPath}
          >
            {copied ? '✓' : '⧉'}
          </button>
          <button type="button" className="file-path-copy" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      {diskNewer && (
        <div className="file-disk-banner" role="status">
          <span>File changed on disk</span>
          <button type="button" className="primary" onClick={() => void loadFromDisk(true)}>
            Reload
          </button>
          <button type="button" onClick={() => setDiskNewer(false)}>
            Keep editing
          </button>
        </div>
      )}

      {error && <div className="empty">{error}</div>}
      {!error && content == null && <div className="empty">Loading…</div>}
      {!error && content != null && mode === 'preview' && previewKind && !binary && (
        <DocumentPreview path={path} content={content} className="file-editor-preview" />
      )}
      {!error && content != null && (mode === 'code' || !previewKind || binary) && (
        <CodeView
          path={path}
          worktreePath={worktreePath}
          value={content}
          readOnly={binary || truncated}
          onChange={setContent}
        />
      )}
    </div>
  );
}
