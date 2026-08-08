import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  resourceHasContentStates,
  type SchemaPaneContent,
  type SchemaRecord,
  type SchemaResource,
} from '../../lib/right-pane';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { createBrightsyDatasource } from './BrightsyDatasource';
import { BrightsyUiRenderer } from './BrightsyUiRenderer';
import type { FilePickerRequest } from './FileManagerColumn';
import type { RelatedNavigation } from './RelationshipFields';
import {
  createBrightsyAIDatasource,
  createBrightsyFileDatasource,
  MemoryFileDatasource,
  type SchemaAIDatasource,
  type SchemaFileDatasource,
} from './SchemaFileDatasource';
import { InlineDatasource, type SchemaDatasource } from './SchemaDatasource';

const SCHEMA_WIDTH_MIN = 320;
const SCHEMA_WIDTH_MAX = 900;
export const SCHEMA_WIDTH_DEFAULT = 420;

interface NavFrame {
  resourceId: string;
  mode: 'table' | 'form';
  recordId?: string | null;
  createDefaults?: Record<string, unknown>;
  title?: string;
}

interface Props {
  content: SchemaPaneContent;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  /** Notify parent when mode/record changes (keeps chips in sync). */
  onContentChange?: (next: SchemaPaneContent) => void;
  worktreeThreadId?: string;
  /** Fill parent tab body (no outer width/resize). */
  embedded?: boolean;
  /** Extra header control (e.g. maximize). */
  headerAction?: ReactNode;
  /**
   * Open / focus a Files tab for browse or form field selection.
   * When `picker` is set, selection returns to this schema tab.
   */
  onRequestFilesTab?: (picker?: FilePickerRequest | null) => void;
}

export function SchemaPane({
  content,
  width = SCHEMA_WIDTH_DEFAULT,
  onWidthChange,
  onClose,
  worktreeThreadId: _worktreeThreadId,
  onContentChange,
  embedded = false,
  headerAction,
  onRequestFilesTab,
}: Props) {
  const [mode, setMode] = useState<'table' | 'form'>(content.mode);
  const [resource, setResource] = useState<SchemaResource | null>(content.resource ?? null);
  const [record, setRecord] = useState<SchemaRecord | null>(content.record ?? null);
  const [createDefaults, setCreateDefaults] = useState<Record<string, unknown> | undefined>();
  const [navStack, setNavStack] = useState<NavFrame[]>([]);
  const [datasource, setDatasource] = useState<SchemaDatasource | null>(null);
  const [fileDatasource, setFileDatasource] = useState<SchemaFileDatasource | null>(null);
  const [aiDatasource, setAiDatasource] = useState<SchemaAIDatasource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const rootResourceId = content.resourceId ?? content.resource?.id;

  useEffect(() => {
    setMode(content.mode);
    setResource(content.resource ?? null);
    setRecord(content.record ?? null);
    setCreateDefaults(undefined);
    setNavStack([]);
  }, [content.id, content.mode, content.resource, content.record]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function boot() {
      try {
        let ds: SchemaDatasource;
        let files: SchemaFileDatasource | null = null;
        let ai: SchemaAIDatasource | null = null;
        if (content.datasource === 'inline') {
          if (!content.resource) {
            throw new Error('Inline schema pane requires an embedded resource');
          }
          ds = new InlineDatasource({
            resource: content.resource,
            records: content.records,
            record: content.record,
          });
          // Demo/inline: in-memory files. Agents can later inject HandlerFileDatasource
          // backed by MCP list_files / upload_file (same interface).
          files = new MemoryFileDatasource();
        } else {
          ds = await createBrightsyDatasource();
          try {
            files = await createBrightsyFileDatasource();
          } catch {
            files = null;
          }
          try {
            ai = await createBrightsyAIDatasource();
          } catch {
            ai = null;
          }
        }
        if (cancelled) return;
        setDatasource(ds);
        setFileDatasource(files);
        setAiDatasource(ai);

        const id = content.resourceId ?? content.resource?.id;
        if (!id) throw new Error('Missing resource id');

        const res = content.resource ?? (await ds.getResource(id));
        if (!res) throw new Error(`Resource not found: ${id}`);
        if (cancelled) return;
        setResource(res);

        if (content.recordId || content.record) {
          const rid = content.record?.id ?? content.recordId!;
          const loaded = content.record ?? (await ds.getRecord(res.id, rid));
          if (cancelled) return;
          setRecord(loaded);
          setMode('form');
        } else if (content.mode === 'form' && !content.recordId) {
          setRecord(null);
          setMode('form');
        } else {
          setMode('table');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setDatasource(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [
    content.id,
    content.datasource,
    content.resourceId,
    content.recordId,
    content.resource,
    content.records,
    content.record,
    content.mode,
  ]);

  const title = resource?.title ?? content.title;

  const pushContent = useCallback(
    (patch: Partial<SchemaPaneContent>) => {
      onContentChange?.({ ...content, ...patch });
    },
    [content, onContentChange],
  );

  const snapshotFrame = useCallback((): NavFrame | null => {
    if (!resource) return null;
    return {
      resourceId: resource.id,
      mode,
      recordId: record?.id ?? (mode === 'form' ? null : undefined),
      createDefaults,
      title: resource.title,
    };
  }, [resource, mode, record, createDefaults]);

  const loadFrame = useCallback(
    async (frame: NavFrame, ds: SchemaDatasource) => {
      setBusy(true);
      setError(null);
      try {
        const res = await ds.getResource(frame.resourceId);
        if (!res) throw new Error(`Resource not found: ${frame.resourceId}`);
        setResource(res);
        setCreateDefaults(frame.createDefaults);
        if (frame.mode === 'form' && frame.recordId) {
          const loaded = await ds.getRecord(res.id, frame.recordId);
          setRecord(loaded);
          setMode('form');
        } else if (frame.mode === 'form') {
          setRecord(null);
          setMode('form');
        } else {
          setRecord(null);
          setMode('table');
        }
        pushContent({
          resourceId: res.id,
          mode: frame.mode,
          recordId: frame.recordId ?? null,
          record: undefined,
          title: frame.title ?? res.title,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [pushContent],
  );

  const openRelated = useCallback(
    async (nav: RelatedNavigation) => {
      if (!datasource) return;
      const current = snapshotFrame();
      if (current) setNavStack((s) => [...s, current]);

      const modeNext: 'table' | 'form' =
        nav.recordId === undefined && !nav.createDefaults ? 'table' : 'form';
      await loadFrame(
        {
          resourceId: nav.resourceId,
          mode: modeNext,
          recordId: nav.recordId ?? null,
          createDefaults: nav.createDefaults,
          title: nav.label,
        },
        datasource,
      );
    },
    [datasource, snapshotFrame, loadFrame],
  );

  const goBack = useCallback(async () => {
    if (!datasource || navStack.length === 0) return;
    const prev = navStack[navStack.length - 1]!;
    setNavStack((s) => s.slice(0, -1));
    await loadFrame(prev, datasource);
  }, [datasource, navStack, loadFrame]);

  const openRecord = useCallback(
    (row: SchemaRecord) => {
      setRecord(row);
      setMode('form');
      setCreateDefaults(undefined);
      pushContent({ mode: 'form', recordId: row.id, record: row });
    },
    [pushContent],
  );

  const startCreate = useCallback(() => {
    setRecord(null);
    setMode('form');
    setCreateDefaults(undefined);
    pushContent({ mode: 'form', recordId: null, record: undefined });
  }, [pushContent]);

  const backToTable = useCallback(() => {
    setMode('table');
    setRecord(null);
    setCreateDefaults(undefined);
    pushContent({ mode: 'table', recordId: null, record: undefined });
  }, [pushContent]);

  async function handleSave(data: Record<string, unknown>) {
    if (!datasource || !resource) return;
    setBusy(true);
    setError(null);
    try {
      if (record?.id) {
        const updated = await datasource.updateRecord(resource.id, record.id, data);
        setRecord(updated);
        pushContent({ record: updated, recordId: updated.id, mode: 'form' });
      } else {
        const created = await datasource.createRecord(resource.id, data);
        setRecord(created);
        setCreateDefaults(undefined);
        pushContent({ record: created, recordId: created.id, mode: 'form' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!datasource?.publishRecord || !resource || !record?.id) return;
    setBusy(true);
    try {
      const updated = await datasource.publishRecord(resource.id, record.id);
      setRecord(updated);
      pushContent({ record: updated });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublish() {
    if (!datasource?.unpublishRecord || !resource || !record?.id) return;
    setBusy(true);
    try {
      const updated = await datasource.unpublishRecord(resource.id, record.id);
      setRecord(updated);
      pushContent({ record: updated });
    } finally {
      setBusy(false);
    }
  }

  const schemaWidth = useMemo(
    () => Math.min(SCHEMA_WIDTH_MAX, Math.max(SCHEMA_WIDTH_MIN, width)),
    [width],
  );

  function handleFilePickerChange(request: FilePickerRequest | null) {
    if (request) onRequestFilesTab?.(request);
  }

  const body = (
    <aside
      className={`artifact-pane schema-pane${embedded ? ' schema-pane-embedded' : ''}`}
      style={embedded ? undefined : { width: schemaWidth }}
    >
      <div className="artifact-pane-header">
        <div className="artifact-pane-title-block">
          <span className="artifact-pane-kind">CMS</span>
          <h3 className="artifact-pane-title" title={title}>
            {title}
          </h3>
        </div>
        <div className="artifact-pane-actions schema-pane-actions">
          {navStack.length > 0 ? (
            <button type="button" className="schema-mode-btn" onClick={() => void goBack()}>
              ← Back
            </button>
          ) : null}
          {mode === 'form' && rootResourceId ? (
            <button type="button" className="schema-mode-btn" onClick={backToTable}>
              Table
            </button>
          ) : null}
          {mode === 'table' ? (
            <button
              type="button"
              className="schema-mode-btn"
              onClick={startCreate}
              disabled={!datasource || !resource}
            >
              New
            </button>
          ) : null}
          {fileDatasource || onRequestFilesTab ? (
            <button
              type="button"
              className="schema-mode-btn"
              title="Open Files tab"
              onClick={() => onRequestFilesTab?.(null)}
            >
              Files
            </button>
          ) : null}
          {headerAction}
          {!embedded ? (
            <button
              type="button"
              className="artifact-pane-close"
              title="Close"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <div className="artifact-pane-body schema-pane-body">
        {loading ? (
          <div className="artifact-pane-loading">Loading schema…</div>
        ) : error ? (
          <div className="schema-error-panel">
            <p>{error}</p>
            {content.datasource === 'brightsy' ? (
              <p className="schema-muted">
                Connect a Brightsy team in Settings, then ask the agent to open the
                schema again.
              </p>
            ) : null}
          </div>
        ) : datasource && resource ? (
          <BrightsyUiRenderer
            mode={mode}
            resource={resource}
            record={record}
            datasource={datasource}
            fileDatasource={fileDatasource}
            aiDatasource={aiDatasource}
            busy={busy}
            createDefaults={createDefaults}
            onOpenRecord={openRecord}
            onCreate={startCreate}
            onSave={handleSave}
            onOpenRelated={(nav) => void openRelated(nav)}
            filePicker={null}
            onFilePickerChange={handleFilePickerChange}
            onPublish={
              resourceHasContentStates(resource) &&
              datasource.publishRecord &&
              record?.id
                ? handlePublish
                : undefined
            }
            onUnpublish={
              resourceHasContentStates(resource) &&
              datasource.unpublishRecord &&
              record?.id
                ? handleUnpublish
                : undefined
            }
          />
        ) : (
          <div className="artifact-pane-loading">No schema</div>
        )}
      </div>
    </aside>
  );

  if (embedded) {
    return <div className="schema-pane-embedded-wrap">{body}</div>;
  }

  return (
    <div className="schema-pane-shell" style={{ width: schemaWidth }}>
      {onWidthChange ? (
        <PanelResizeHandle
          edge="left"
          value={schemaWidth}
          min={SCHEMA_WIDTH_MIN}
          max={SCHEMA_WIDTH_MAX}
          onChange={onWidthChange}
        />
      ) : null}
      {body}
    </div>
  );
}
