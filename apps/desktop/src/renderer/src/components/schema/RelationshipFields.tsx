/**
 * Sideboard has-one / has-many fields for schema CMS.
 * Reference: brightsy-ai/apps/desktop/src/renderer/components/RelationshipFields.tsx
 * (separate instance — datasource-driven; navigates inside SchemaPane instead of routes)
 */
import { useEffect, useMemo, useState } from 'react';
import type { SchemaRecord } from '../../lib/right-pane';
import type { SchemaDatasource } from './SchemaDatasource';

export interface RelatedNavigation {
  resourceId: string;
  recordId?: string | null;
  /** Prefill fields when creating a related record (e.g. foreign key). */
  createDefaults?: Record<string, unknown>;
  label?: string;
}

function recordLabel(r: SchemaRecord): string {
  const d = r.data;
  return String(d.title ?? d.name ?? d.label ?? d.slug ?? r.id);
}

export function HasOneField({
  name,
  label,
  description,
  recordType,
  value,
  onChange,
  required,
  disabled,
  datasource,
  onOpenRelated,
}: {
  name: string;
  label?: string;
  description?: string;
  recordType: string;
  value?: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  disabled?: boolean;
  datasource: SchemaDatasource;
  onOpenRelated?: (nav: RelatedNavigation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<SchemaRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recordType || !datasource.listRelatedRecords) return;
    let cancelled = false;
    setLoading(true);
    void datasource
      .listRelatedRecords(recordType, { search: search.trim() || undefined, limit: 100 })
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordType, datasource, search]);

  const current = useMemo(
    () => rows.find((r) => r.id === value) ?? null,
    [rows, value],
  );

  return (
    <div className="schema-rel">
      {label ? (
        <label className="schema-label">
          {label}
          {required ? <span className="schema-req">*</span> : null}
        </label>
      ) : null}
      {description ? <div className="schema-help">{description}</div> : null}
      <div className="schema-rel-picker">
        <button
          type="button"
          className="schema-input schema-rel-trigger"
          disabled={disabled || loading}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={current || value ? '' : 'schema-muted'}>
            {current ? recordLabel(current) : value ? value : 'Select a record…'}
          </span>
          <span aria-hidden>▾</span>
        </button>
        {open ? (
          <div className="schema-rel-menu">
            <input
              className="schema-input"
              placeholder="Search…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="schema-rel-options">
              <button
                type="button"
                className={!value ? 'active' : ''}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                — None —
              </button>
              {loading ? (
                <div className="schema-muted schema-rel-empty">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="schema-muted schema-rel-empty">No records</div>
              ) : (
                rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={value === r.id ? 'active' : ''}
                    onClick={() => {
                      onChange(r.id);
                      setOpen(false);
                    }}
                  >
                    {recordLabel(r)}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
      {value && onOpenRelated ? (
        <button
          type="button"
          className="schema-rel-link"
          onClick={() =>
            onOpenRelated({
              resourceId: recordType,
              recordId: value,
              label: current ? recordLabel(current) : value,
            })
          }
        >
          Open related →
        </button>
      ) : null}
      <span className="schema-help schema-rel-field-name" hidden>
        {name}
      </span>
    </div>
  );
}

export function HasManyField({
  label,
  description,
  recordType,
  foreignKey,
  currentRecordId,
  datasource,
  onOpenRelated,
  showContentStates = false,
}: {
  name: string;
  label?: string;
  description?: string;
  recordType: string;
  foreignKey: string;
  currentRecordId?: string | null;
  datasource: SchemaDatasource;
  onOpenRelated?: (nav: RelatedNavigation) => void;
  showContentStates?: boolean;
}) {
  const [rows, setRows] = useState<SchemaRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentRecordId || !recordType || !foreignKey) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void datasource
      .listRecords(recordType, {
        filters: { [foreignKey]: currentRecordId },
        page: 1,
        pageSize: 25,
      })
      .then((res) => {
        if (!cancelled) setRows(res.records);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasource, recordType, foreignKey, currentRecordId]);

  if (!currentRecordId) {
    return (
      <div className="schema-rel">
        {label ? <div className="schema-label">{label}</div> : null}
        <div className="schema-rel-empty-box">
          Save this record first to manage related {label || 'records'}
        </div>
      </div>
    );
  }

  return (
    <div className="schema-rel">
      <div className="schema-rel-header">
        {label ? <div className="schema-label">{label}</div> : null}
        <span className="schema-badge draft">
          {loading ? '…' : `${rows.length} related`}
        </span>
      </div>
      {description ? <div className="schema-help">{description}</div> : null}
      {error ? <div className="schema-error">{error}</div> : null}
      <div className="schema-rel-list">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className="schema-rel-row"
            onClick={() =>
              onOpenRelated?.({
                resourceId: recordType,
                recordId: r.id,
                label: recordLabel(r),
              })
            }
          >
            <span>{recordLabel(r)}</span>
            {showContentStates ? (
              <span className={`schema-badge ${r.publishedAt ? 'published' : 'draft'}`}>
                {r.publishedAt ? 'Published' : 'Draft'}
              </span>
            ) : null}
          </button>
        ))}
        {!loading && rows.length === 0 ? (
          <div className="schema-muted schema-rel-empty">No related records</div>
        ) : null}
      </div>
      <div className="schema-rel-actions">
        <button
          type="button"
          onClick={() =>
            onOpenRelated?.({
              resourceId: recordType,
              recordId: null,
              createDefaults: { [foreignKey]: currentRecordId },
              label: `New ${label || recordType}`,
            })
          }
        >
          + New related
        </button>
        <button
          type="button"
          onClick={() =>
            onOpenRelated?.({
              resourceId: recordType,
              recordId: undefined,
              label: label || recordType,
            })
          }
        >
          View all →
        </button>
      </div>
    </div>
  );
}
