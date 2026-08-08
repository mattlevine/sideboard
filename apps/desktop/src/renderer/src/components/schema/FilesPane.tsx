/**
 * Standalone Files column opened via MCP present_files (or CMS Files toggle).
 */
import { useEffect, useMemo, useState } from 'react';
import type { FilesPaneContent } from '../../lib/right-pane';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { FILE_COLUMN_WIDTH, FileManagerColumn } from './FileManagerColumn';
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
}

export function FilesPane({
  content,
  width = FILES_WIDTH_DEFAULT,
  onWidthChange,
  onClose,
  worktreeThreadId,
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

  if (loading) {
    return (
      <aside className="artifact-pane file-pane-standalone" style={{ width: clamped }}>
        {onWidthChange ? (
          <PanelResizeHandle
            edge="left"
            value={clamped}
            min={FILES_WIDTH_MIN}
            max={FILES_WIDTH_MAX}
            onChange={onWidthChange}
          />
        ) : null}
        <div className="artifact-pane-loading">Loading files…</div>
      </aside>
    );
  }

  if (error || !datasource) {
    return (
      <aside className="artifact-pane file-pane-standalone" style={{ width: clamped }}>
        {onWidthChange ? (
          <PanelResizeHandle
            edge="left"
            value={clamped}
            min={FILES_WIDTH_MIN}
            max={FILES_WIDTH_MAX}
            onChange={onWidthChange}
          />
        ) : null}
        <div className="artifact-pane-header">
          <div className="artifact-pane-title-block">
            <span className="artifact-pane-kind">FILES</span>
            <h3 className="artifact-pane-title">{content.title}</h3>
          </div>
          <button type="button" className="artifact-pane-close" onClick={onClose}>
            ×
          </button>
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
      </aside>
    );
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
      <FileManagerColumn
        datasource={datasource}
        request={{
          title: content.title,
          accept: 'all',
          mode: 'media',
          onSelect: () => {
            /* browse mode — selecting a file just confirms the column works */
          },
        }}
        onClose={onClose}
        initialPath={content.path}
        worktreeThreadId={worktreeThreadId}
      />
    </div>
  );
}
