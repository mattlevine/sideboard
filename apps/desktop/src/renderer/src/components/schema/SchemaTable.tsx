import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  resourceHasContentStates,
  type SchemaRecord,
  type SchemaResource,
} from '../../lib/right-pane';
import type { SchemaDatasource } from './SchemaDatasource';
import { getListFields, getSchemaProperties } from './schema-utils';

interface Props {
  resource: SchemaResource;
  datasource: SchemaDatasource;
  onOpenRecord: (record: SchemaRecord) => void;
  onCreate?: () => void;
}

export function SchemaTable({ resource, datasource, onOpenRecord, onCreate }: Props) {
  const showContentStates = resourceHasContentStates(resource);
  const columns = useMemo(
    () => getListFields(resource.schema, resource.schemaUi),
    [resource.schema, resource.schemaUi],
  );
  const titles = useMemo(() => {
    const props = getSchemaProperties(resource.schema);
    const ui = resource.schemaUi ?? {};
    const map: Record<string, string> = {};
    for (const col of columns) {
      const field = props[col];
      const fieldUi = ui[col] as Record<string, unknown> | undefined;
      map[col] = String(fieldUi?.['ui:title'] ?? field?.title ?? col);
    }
    return map;
  }, [columns, resource.schema, resource.schemaUi]);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SchemaRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await datasource.listRecords(resource.id, {
        search: search.trim() || undefined,
        page,
        pageSize,
      });
      setRows(result.records);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [datasource, resource.id, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="schema-table">
      <div className="schema-table-toolbar">
        <input
          className="schema-input schema-search"
          placeholder="Filter…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <button type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
        {onCreate ? (
          <button type="button" className="primary" onClick={onCreate}>
            New
          </button>
        ) : null}
      </div>
      {error ? <div className="schema-error">{error}</div> : null}
      <div className="schema-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{titles[col] ?? col}</th>
              ))}
              {showContentStates ? <th>Status</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (showContentStates ? 1 : 0)}
                  className="schema-muted"
                >
                  Loading…
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (showContentStates ? 1 : 0)}
                  className="schema-muted"
                >
                  No records
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr
                key={row.id}
                className="schema-row"
                onClick={() => onOpenRecord(row)}
              >
                {columns.map((col) => (
                  <td key={col}>{formatCell(row.data[col])}</td>
                ))}
                {showContentStates ? (
                  <td>
                    <span
                      className={`schema-badge ${row.publishedAt ? 'published' : 'draft'}`}
                    >
                      {row.publishedAt ? 'Published' : 'Draft'}
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="schema-table-footer">
        <span className="schema-muted">
          {total} record{total === 1 ? '' : 's'}
        </span>
        <div className="schema-pager">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
