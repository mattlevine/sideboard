/**
 * CMS file manager as a Sideboard column (not a modal).
 * Reference: Brightsy web FileManager features over SchemaFileDatasource.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  getSideboardFileDrag,
  hasSideboardFileDrag,
  worktreePathToFile,
} from '../../lib/sideboard-file-drag';
import type { SchemaFileDatasource, SchemaFileEntry } from './SchemaFileDatasource';

export type FileAccept = 'image' | 'video' | 'audio' | 'all';

export interface FilePickerRequest {
  accept?: FileAccept;
  mode?: 'media' | 'link';
  title?: string;
  onSelect: (fileUrl: string, file?: SchemaFileEntry) => void;
}

interface Props {
  datasource: SchemaFileDatasource;
  request: FilePickerRequest;
  onClose: () => void;
  /** Initial folder (e.g. from present_files path). */
  initialPath?: string;
  /** Active thread for resolving Sideboard worktree file drags. */
  worktreeThreadId?: string;
  /** Column width in px (default FILE_COLUMN_WIDTH). Ignored when `fill`. */
  width?: number;
  /** Stretch to parent (tab body). */
  fill?: boolean;
  /** Highlight selection mode (form file picker). */
  selecting?: boolean;
}

function matchesAccept(entry: SchemaFileEntry, accept: FileAccept): boolean {
  if (accept === 'all' || entry.type === 'folder') return true;
  const ct = (entry.contentType ?? '').toLowerCase();
  const name = entry.name.toLowerCase();
  if (accept === 'image') {
    return ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name);
  }
  if (accept === 'video') {
    return ct.startsWith('video/') || /\.(mp4|webm|mov)$/.test(name);
  }
  if (accept === 'audio') {
    return ct.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/.test(name);
  }
  return true;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const FILE_COLUMN_WIDTH = 320;
export const FILE_COLUMN_MIN = 240;
export const FILE_COLUMN_MAX = 560;

export function FileManagerColumn({
  datasource,
  request,
  onClose,
  initialPath,
  worktreeThreadId,
  width = FILE_COLUMN_WIDTH,
  fill = false,
  selecting = false,
}: Props) {
  const accept = request.accept ?? 'all';
  const mode = request.mode ?? 'media';
  const title = request.title ?? 'Files';

  const [path, setPath] = useState(initialPath?.trim() || 'public');

  useEffect(() => {
    if (initialPath?.trim()) setPath(initialPath.trim());
  }, [initialPath]);
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<SchemaFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await datasource.list({
        path: path || undefined,
        search: search.trim() || undefined,
      });
      setEntries(rows.filter((e) => matchesAccept(e, accept)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /failed to fetch/i.test(msg)
          ? `${msg} — check Brightsy login in Settings and that the API endpoint is reachable`
          : msg,
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [datasource, path, search, accept]);

  useEffect(() => {
    void load();
  }, [load]);

  const crumbs = path ? path.split('/').filter(Boolean) : [];

  async function pickFile(entry: SchemaFileEntry) {
    if (entry.type === 'folder') {
      setPath(entry.path);
      return;
    }
    try {
      let url = entry.url;
      if (!url) {
        url = await datasource.getSignedUrl({ path: entry.path, expiresIn: 3600 });
      }
      request.onSelect(url, entry);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        await datasource.upload({
          path: path || undefined,
          filename: file.name,
          file,
          contentType: file.type || undefined,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    await uploadFiles(Array.from(fileList));
  }

  function canAcceptDrop(dt: DataTransfer): boolean {
    if (hasSideboardFileDrag(dt)) return true;
    if (dt.files?.length) return true;
    return Array.from(dt.types).some(
      (t) => t === 'Files' || t === 'application/x-moz-file',
    );
  }

  function onDragEnter(e: DragEvent) {
    if (!canAcceptDrop(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget instanceof Node && e.currentTarget.contains(next)) {
      return;
    }
    setDragOver(false);
  }

  function onDragOver(e: DragEvent) {
    if (!canAcceptDrop(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (uploading) return;

    const sideboard = getSideboardFileDrag(e.dataTransfer);
    const osFiles = Array.from(e.dataTransfer.files ?? []);

    if (sideboard?.paths.length) {
      const threadId = sideboard.threadId || worktreeThreadId;
      if (!threadId) {
        setError('Drop worktree files while a thread is open');
        return;
      }
      try {
        const files: File[] = [];
        for (const rel of sideboard.paths) {
          files.push(await worktreePathToFile(threadId, rel));
        }
        await uploadFiles(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (osFiles.length) {
      await uploadFiles(osFiles);
    }
  }

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    setError(null);
    try {
      await datasource.createFolder({ path: path || undefined, folderName: name });
      setFolderName('');
      setShowNewFolder(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(entry: SchemaFileEntry) {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    try {
      await datasource.delete(entry.path);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside
      className={`file-pane${dragOver ? ' file-pane-dragover' : ''}${
        fill ? ' file-pane-fill' : ''
      }${selecting ? ' file-pane-selecting' : ''}`}
      style={fill ? undefined : { width }}
      aria-label={title}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="artifact-pane-header">
        <div className="artifact-pane-title-block">
          <span className="artifact-pane-kind">
            {selecting ? 'SELECT' : 'FILES'}
          </span>
          <h3 className="artifact-pane-title" title={title}>
            {selecting ? `Choose file · ${title}` : title}
          </h3>
        </div>
        <button
          type="button"
          className="artifact-pane-close"
          title={selecting ? 'Cancel selection' : 'Close files'}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="file-pane-toolbar">
        <div className="schema-fm-crumbs">
          <button type="button" onClick={() => setPath('')}>
            /
          </button>
          {crumbs.map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          className="schema-input schema-fm-search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="file-pane-actions">
          <button type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <button type="button" onClick={() => setShowNewFolder((v) => !v)}>
            Folder
          </button>
          <button
            type="button"
            className="primary"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? '…' : 'Upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={
              accept === 'image'
                ? 'image/*'
                : accept === 'video'
                  ? 'video/*'
                  : accept === 'audio'
                    ? 'audio/*'
                    : undefined
            }
            onChange={(e) => void onUpload(e.target.files)}
          />
        </div>
      </div>

      {showNewFolder ? (
        <div className="schema-fm-inline">
          <input
            className="schema-input"
            placeholder="Folder name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            autoFocus
          />
          <button type="button" className="primary" onClick={() => void createFolder()}>
            Create
          </button>
        </div>
      ) : null}

      {error ? <div className="schema-error">{error}</div> : null}

      <div className="file-pane-list">
        {dragOver ? (
          <div className="file-pane-drop-hint">Drop to upload</div>
        ) : null}
        {loading ? <div className="schema-muted">Loading…</div> : null}
        {!loading && entries.length === 0 && !dragOver ? (
          <div className="schema-muted">No files — drop or Upload</div>
        ) : null}
        {entries.map((entry) => (
          <div key={entry.path} className="schema-fm-row">
            <button
              type="button"
              className="schema-fm-row-main"
              onClick={() => void pickFile(entry)}
            >
              <span className="schema-fm-icon" aria-hidden>
                {entry.type === 'folder' ? 'DIR' : 'FILE'}
              </span>
              <span className="schema-fm-name">{entry.name}</span>
              {entry.type === 'file' && entry.size != null ? (
                <span className="schema-muted">{formatSize(entry.size)}</span>
              ) : null}
            </button>
            {entry.type === 'file' ? (
              <button
                type="button"
                className="schema-fm-select"
                title={mode === 'link' ? 'Use as link' : 'Select'}
                onClick={() => void pickFile(entry)}
              >
                Use
              </button>
            ) : null}
            <button
              type="button"
              className="schema-fm-del"
              title="Delete"
              onClick={() => void remove(entry)}
            >
              ⌫
            </button>
          </div>
        ))}
      </div>

      <div className="file-pane-footer">
        <span className="schema-muted">
          {datasource.kind}
          {path ? ` · ${path}` : ''}
          {' · drop files to upload'}
        </span>
      </div>
    </aside>
  );
}
