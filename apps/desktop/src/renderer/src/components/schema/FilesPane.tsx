/**
 * Files tab — CMS file manager (standalone or embedded in the right column).
 */
import { useEffect, useMemo, useState } from 'react';
import type { FilesPaneContent } from '../../lib/right-pane';
import { PanelResizeHandle } from '../PanelResizeHandle';
import {
  FILE_COLUMN_WIDTH,
  FileManagerColumn,
  type FilePickerRequest,
} from './FileManagerColumn';
import type { SchemaFileEntry } from './SchemaFileDatasource';
import {
  createBrightsyFileDatasource,
  MemoryFileDatasource,
  type SchemaFileDatasource,
} from './SchemaFileDatasource';

const FILES_WIDTH_MIN = 280;
const FILES_WIDTH_MAX = 560;
export const FILES_WIDTH_DEFAULT = FILE_COLUMN_WIDTH;

interface Props {
  content: FilesPaneContent;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  worktreeThreadId?: string;
  /** Fill parent tab body (no outer width/resize). */
  embedded?: boolean;
  /** When set, Use/select returns a file to the caller. */
  pickerRequest?: FilePickerRequest | null;
  onPickerSelect?: (fileUrl: string, file?: SchemaFileEntry) => void;
  onPickerCancel?: () => void;
}

export function FilesPane({
  content,
  width = FILES_WIDTH_DEFAULT,
  onWidthChange,
  onClose,
  worktreeThreadId,
  embedded = false,
  pickerRequest = null,
  onPickerSelect,
  onPickerCancel,
}: Props) {
  const [datasource, setDatasource] = useState<SchemaFileDatasource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let ds: SchemaFileDatasource;
        if (content.datasource === 'memory') {
          ds = new MemoryFileDatasource();
        } else {
          ds = await createBrightsyFileDatasource();
        }
        if (!cancelled) setDatasource(ds);
      } catch (err) {
        if (!cancelled) {
          setDatasource(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content.id, content.datasource]);

  const clamped = useMemo(
    () => Math.min(FILES_WIDTH_MAX, Math.max(FILES_WIDTH_MIN, width)),
    [width],
  );

  const request: FilePickerRequest = pickerRequest
    ? {
        ...pickerRequest,
        title: pickerRequest.title ?? content.title,
        onSelect: (url, file) => {
          if (onPickerSelect) onPickerSelect(url, file);
          else pickerRequest.onSelect(url, file);
        },
      }
    : {
        title: content.title,
        accept: 'all',
        mode: 'media',
        onSelect: () => {
          /* browse mode */
        },
      };

  const body = (() => {
    if (loading) {
      return <div className="artifact-pane-loading">Loading files…</div>;
    }
    if (error || !datasource) {
      return (
        <>
          <div className="artifact-pane-header">
            <div className="artifact-pane-title-block">
              <span className="artifact-pane-kind">FILES</span>
              <h3 className="artifact-pane-title">{content.title}</h3>
            </div>
            {!embedded ? (
              <button type="button" className="artifact-pane-close" onClick={onClose}>
                ×
              </button>
            ) : null}
          </div>
          <div className="schema-error-panel">
            <p>{error || 'No file datasource'}</p>
            {content.datasource === 'brightsy' ? (
              <p className="schema-muted">
                Connect a Brightsy team in Settings, or call present_files with
                datasource=memory for a local demo store.
              </p>
            ) : null}
          </div>
        </>
      );
    }
    return (
      <FileManagerColumn
        datasource={datasource}
        request={request}
        onClose={pickerRequest ? () => onPickerCancel?.() : onClose}
        initialPath={content.path}
        worktreeThreadId={worktreeThreadId}
        width={embedded ? undefined : clamped}
        fill={embedded}
        selecting={Boolean(pickerRequest)}
      />
    );
  })();

  if (embedded) {
    return <div className="files-pane-embedded">{body}</div>;
  }

  return (
    <div className="files-pane-shell" style={{ width: clamped }}>
      {onWidthChange ? (
        <PanelResizeHandle
          edge="left"
          value={clamped}
          min={FILES_WIDTH_MIN}
          max={FILES_WIDTH_MAX}
          onChange={onWidthChange}
        />
      ) : null}
      {body}
    </div>
  );
}
