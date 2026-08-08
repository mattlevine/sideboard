import type { SchemaRecord, SchemaResource } from '../../lib/right-pane';

export interface ListRecordsQuery {
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  /** Simple field equality filters. */
  filters?: Record<string, string>;
}

export interface ListRecordsResult {
  records: SchemaRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Datasource-agnostic CMS backend. Brightsy is one implementation;
 * InlineDatasource serves present_schema payloads without a network.
 */
export interface SchemaDatasource {
  readonly kind: 'brightsy' | 'inline';
  listResources(): Promise<SchemaResource[]>;
  getResource(id: string): Promise<SchemaResource | null>;
  listRecords(resourceId: string, query?: ListRecordsQuery): Promise<ListRecordsResult>;
  getRecord(resourceId: string, recordId: string): Promise<SchemaRecord | null>;
  createRecord(resourceId: string, data: Record<string, unknown>): Promise<SchemaRecord>;
  updateRecord(
    resourceId: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<SchemaRecord>;
  publishRecord?(resourceId: string, recordId: string): Promise<SchemaRecord>;
  unpublishRecord?(resourceId: string, recordId: string): Promise<SchemaRecord>;
  /** Optional: related records for has-one pickers / has-many helpers. */
  listRelatedRecords?(
    relatedResourceId: string,
    opts?: { search?: string; limit?: number; filters?: Record<string, string> },
  ): Promise<SchemaRecord[]>;
}

export class InlineDatasource implements SchemaDatasource {
  readonly kind = 'inline' as const;
  private resources = new Map<string, SchemaResource>();
  private records = new Map<string, SchemaRecord[]>();

  constructor(opts: {
    resource: SchemaResource;
    records?: SchemaRecord[];
    record?: SchemaRecord;
  }) {
    this.resources.set(opts.resource.id, opts.resource);
    const list = [...(opts.records ?? [])];
    if (opts.record && !list.some((r) => r.id === opts.record!.id)) {
      list.push(opts.record);
    }
    this.records.set(opts.resource.id, list);
  }

  async listResources(): Promise<SchemaResource[]> {
    return [...this.resources.values()];
  }

  async getResource(id: string): Promise<SchemaResource | null> {
    return this.resources.get(id) ?? null;
  }

  async listRecords(resourceId: string, query?: ListRecordsQuery): Promise<ListRecordsResult> {
    let rows = [...(this.records.get(resourceId) ?? [])];
    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
    }
    if (query?.filters) {
      for (const [field, value] of Object.entries(query.filters)) {
        if (!value) continue;
        rows = rows.filter((r) => String(r.data[field] ?? '') === value);
      }
    }
    if (query?.sortField) {
      const field = query.sortField;
      const dir = query.sortDir === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const av = a.data[field];
        const bv = b.data[field];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      });
    }
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 25;
    const start = (page - 1) * pageSize;
    return {
      records: rows.slice(start, start + pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  async getRecord(resourceId: string, recordId: string): Promise<SchemaRecord | null> {
    return (this.records.get(resourceId) ?? []).find((r) => r.id === recordId) ?? null;
  }

  async createRecord(resourceId: string, data: Record<string, unknown>): Promise<SchemaRecord> {
    const rec: SchemaRecord = {
      id: `inline_${Date.now().toString(36)}`,
      data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const list = this.records.get(resourceId) ?? [];
    list.unshift(rec);
    this.records.set(resourceId, list);
    return rec;
  }

  async updateRecord(
    resourceId: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<SchemaRecord> {
    const list = this.records.get(resourceId) ?? [];
    const idx = list.findIndex((r) => r.id === recordId);
    if (idx < 0) throw new Error(`Record not found: ${recordId}`);
    const next: SchemaRecord = {
      ...list[idx]!,
      data: { ...list[idx]!.data, ...data },
      updatedAt: new Date().toISOString(),
    };
    list[idx] = next;
    this.records.set(resourceId, list);
    return next;
  }

  async publishRecord(resourceId: string, recordId: string): Promise<SchemaRecord> {
    const rec = await this.getRecord(resourceId, recordId);
    if (!rec) throw new Error(`Record not found: ${recordId}`);
    const next = { ...rec, publishedAt: new Date().toISOString() };
    const list = this.records.get(resourceId) ?? [];
    const idx = list.findIndex((r) => r.id === recordId);
    if (idx >= 0) list[idx] = next;
    return next;
  }

  async unpublishRecord(resourceId: string, recordId: string): Promise<SchemaRecord> {
    const rec = await this.getRecord(resourceId, recordId);
    if (!rec) throw new Error(`Record not found: ${recordId}`);
    const next = { ...rec, publishedAt: null };
    const list = this.records.get(resourceId) ?? [];
    const idx = list.findIndex((r) => r.id === recordId);
    if (idx >= 0) list[idx] = next;
    return next;
  }

  async listRelatedRecords(
    relatedResourceId: string,
    opts?: { search?: string; limit?: number; filters?: Record<string, string> },
  ): Promise<SchemaRecord[]> {
    const result = await this.listRecords(relatedResourceId, {
      search: opts?.search,
      filters: opts?.filters,
      page: 1,
      pageSize: opts?.limit ?? 50,
    });
    return result.records;
  }
}
