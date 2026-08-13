import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffScope, ThreadAttachment } from '@sideboard-ai/core';
import {
  buildDiffCommentAttachment,
  type DiffCommentLine,
} from '@sideboard/diff-comment';
import { documentPreviewKind } from '../lib/language';
import { parseUnifiedPatch } from '../lib/tool-diff';
import { DiffLines } from './DiffLines';
import { DocumentPreview, DocumentPreviewModeToggle } from './DocumentPreview';
import { GitChangeBadge } from './GitChangeBadge';
import { PanePreloader } from './PanePreloader';

const CodeView = lazy(() =>
  import('./CodeView').then((m) => ({ default: m.CodeView })),
);

interface Props {
  threadId: string;
  path: string;
  worktreePath: string;
  /** Prefer Diff when opening from the Changes tab. */
  initialView?: 'edit' | 'diff';
  /** Match the Changes panel filter so Diff doesn't re-resolve vs default branch. */
  diffScope?: DiffScope;
  commitSha?: string | null;
  diffBase?: string | null;
  onClose: () => void;
  onSaved?: () => void;
  /** Attach a line-anchored diff comment to the thread composer. */
  onDiffComment?: (attachment: ThreadAttachment) => void;
}

export function FileEditor({
  threadId,
  path,
  worktreePath,
  initialView = 'edit',
  diffScope = 'uncommitted',
  commitSha = null,
  diffBase = null,
  onClose,
  onSaved,
  onDiffComment,
}: Props) {
  const previewKind = documentPreviewKind(path);
  const isImage = previewKind === 'image';
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [encoding, setEncoding] = useState<'utf8' | 'base64'>('utf8');
  const [truncated, setTruncated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diskNewer, setDiskNewer] = useState(false);
  const [mode, setMode] = useState<'code' | 'preview' | 'diff'>(
    initialView === 'diff' ? 'diff' : isImage ? 'preview' : 'code',
  );
  const [patch, setPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(initialView === 'diff');
  const [changeMeta, setChangeMeta] = useState<{
    status: string;
    additions?: number;
    deletions?: number;
  } | null>(null);

  useEffect(() => {
    setMode(initialView === 'diff' ? 'diff' : isImage ? 'preview' : 'code');
  }, [path, initialView, isImage]);

  const loadPatch = useCallback(async () => {
    setDiffLoading(true);
    setPatch(null);
    try {
      const d = await window.sideboard.getDiff(threadId, {
        path,
        scope: diffScope,
        commitSha: diffScope === 'commits' ? commitSha : null,
        base: diffBase ?? undefined,
        includeMeta: false,
        includeUntracked: false,
      });
      const file = d.files.find((f) => f.path === path) ?? d.files[0];
      if (file) {
        setPatch(file.patch || '');
        setChangeMeta({
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        });
      } else {
        setPatch(null);
        setChangeMeta(null);
        setMode((m) => (m === 'diff' ? 'code' : m));
      }
    } catch {
      setPatch(null);
      setChangeMeta(null);
    } finally {
      setDiffLoading(false);
    }
  }, [commitSha, diffBase, diffScope, path, threadId]);

  useEffect(() => {
    void loadPatch();
  }, [loadPatch]);

  const diffRows = useMemo(
    () => (mode === 'diff' && patch != null && !diffLoading ? parseUnifiedPatch(patch) : null),
    [mode, patch, diffLoading],
  );

  const dirty = content != null && content !== saved && !binary && !truncated;
  const dirtyRef = useRef(dirty);
  const contentRef = useRef(content);
  dirtyRef.current = dirty;
  contentRef.current = content;

  const applyDiskRead = useCallback(
    (
      r: {
        content: string;
        truncated: boolean;
        binary: boolean;
        encoding?: 'utf8' | 'base64';
      },
      force: boolean,
    ) => {
      if (!force && dirtyRef.current) {
        if (r.content !== contentRef.current) setDiskNewer(true);
        return;
      }
      setBinary(r.binary);
      setEncoding(r.encoding ?? 'utf8');
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
    if (mode === 'diff') return;
    let cancelled = false;
    setContent(null);
    setError(null);
    setBinary(false);
    setEncoding('utf8');
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
  }, [applyDiskRead, threadId, path, mode]);

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
      void loadPatch();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [binary, content, loadPatch, onSaved, path, saving, threadId, truncated]);

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
          {changeMeta && (
            <GitChangeBadge change={changeMeta} />
          )}
          {patch != null && (
            <div className="doc-preview-toggle" role="group" aria-label="File view">
              <button
                type="button"
                className={mode === 'diff' ? 'active' : ''}
                aria-pressed={mode === 'diff'}
                onClick={() => setMode('diff')}
              >
                Diff
              </button>
              <button
                type="button"
                className={mode === 'code' || mode === 'preview' ? 'active' : ''}
                aria-pressed={mode === 'code' || mode === 'preview'}
                onClick={() => setMode(isImage ? 'preview' : 'code')}
              >
                {isImage ? 'Preview' : 'Edit'}
              </button>
            </div>
          )}
          {previewKind && !isImage && !binary && (mode === 'code' || mode === 'preview') && (
            <DocumentPreviewModeToggle
              mode={mode}
              onChange={setMode}
            />
          )}
          {(binary || truncated) && (
            <span className="thread-meta">
              {isImage
                ? truncated
                  ? 'Image — truncated'
                  : 'Image — view only'
                : binary
                  ? 'Binary — view only'
                  : 'Truncated — view only'}
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
      {!error && mode === 'diff' && (
        <div className="file-editor-diff">
          {diffLoading || (patch != null && diffRows == null) ? (
            <PanePreloader
              label={diffLoading || patch == null ? 'Loading diff' : 'Rendering diff'}
            />
          ) : patch == null || diffRows == null ? (
            <div className="pane-preloader" role="status">
              No diff available
            </div>
          ) : (
            <DiffLines
              className="tool-diff-body file-diff-lines"
              rows={diffRows}
              commentable={Boolean(onDiffComment)}
              onSubmitComment={
                onDiffComment
                  ? ({ comment, lines }: { comment: string; lines: DiffCommentLine[] }) => {
                      onDiffComment(
                        buildDiffCommentAttachment({
                          path,
                          comment,
                          lines,
                        }),
                      );
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}
      {!error && content == null && mode !== 'diff' && <div className="empty">Loading…</div>}
      {!error &&
        content != null &&
        mode === 'preview' &&
        previewKind &&
        (isImage || !binary) && (
          <DocumentPreview
            path={path}
            content={content}
            encoding={encoding}
            className="file-editor-preview"
          />
        )}
      {!error && content != null && mode === 'code' && !isImage && (
        <Suspense fallback={<PanePreloader label="Loading editor" />}>
          <CodeView
            path={path}
            worktreePath={worktreePath}
            value={content}
            readOnly={binary || truncated}
            onChange={setContent}
          />
        </Suspense>
      )}
    </div>
  );
}
