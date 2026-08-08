import { BrightsyClient } from '@brightsy/client';
import type { SchemaRecord, SchemaResource } from '../../lib/right-pane';
import type {
  ListRecordsQuery,
  ListRecordsResult,
  SchemaDatasource,
} from './SchemaDatasource';

export interface BrightsyCmsAuth {
  endpoint: string;
  accessToken: string;
  accountId: string;
  accountSlug: string | null;
}

function mapRecord(raw: any): SchemaRecord {
  const data =
    (raw?.data && typeof raw.data === 'object' ? raw.data : null) ??
    (raw?.fields && typeof raw.fields === 'object' ? raw.fields : null) ??
    {};
  return {
    id: String(raw?.id ?? ''),
    data: data as Record<string, unknown>,
    publishedAt: raw?.published_at ?? raw?.publishedAt ?? null,
    updatedAt: raw?.updated_at ?? raw?.updatedAt ?? null,
    createdAt: raw?.created_at ?? raw?.createdAt ?? null,
  };
}

function mapResource(rt: any): SchemaResource {
  const schema =
    (rt?.schema && typeof rt.schema === 'object' ? rt.schema : null) ??
    (rt?.json_schema && typeof rt.json_schema === 'object' ? rt.json_schema : {}) ??
    {};
  const schemaUi =
    rt?.schema_ui ??
    rt?.schemaUi ??
    (schema as any)?.schema_ui ??
    (schema as any)?.schemaUi;
  return {
    id: String(rt?.id ?? rt?.slug ?? ''),
    title: String(rt?.name ?? rt?.title ?? rt?.slug ?? 'Record type'),
    slug: rt?.slug ? String(rt.slug) : undefined,
    schema: schema as Record<string, unknown>,
    schemaUi:
      schemaUi && typeof schemaUi === 'object'
        ? (schemaUi as Record<string, unknown>)
        : undefined,
    // Brightsy CMA: save (update) and publish are separate MCP/API commands.
    contentStates: ['draft', 'published'],
  };
}

/**
 * Brightsy CMS datasource — first SchemaDatasource provider.
 * Resolves resources by record-type UUID or slug.
 */
export class BrightsyDatasource implements SchemaDatasource {
  readonly kind = 'brightsy' as const;
  private client: BrightsyClient;
  private typeCache: SchemaResource[] | null = null;
  private slugById = new Map<string, string>();

  constructor(auth: BrightsyCmsAuth) {
    this.client = new BrightsyClient({
      endpoint: auth.endpoint,
      account_id: auth.accountId,
      authMode: 'oauth',
      oauthAccessToken: auth.accessToken,
    });
  }

  private async ensureTypes(): Promise<SchemaResource[]> {
    if (this.typeCache) return this.typeCache;
    const list = await this.client.recordTypes.list();
    const arr = Array.isArray(list) ? list : (list as any)?.data ?? [];
    const mapped: SchemaResource[] = arr.map(mapResource);
    this.typeCache = mapped;
    this.slugById.clear();
    for (const rt of mapped) {
      if (rt.slug) {
        this.slugById.set(rt.id, rt.slug);
        this.slugById.set(rt.slug, rt.slug);
      }
    }
    return mapped;
  }

  private async resolveSlug(resourceId: string): Promise<string> {
    await this.ensureTypes();
    const slug = this.slugById.get(resourceId);
    if (slug) return slug;
    // Maybe resourceId is already a slug
    const found = (this.typeCache ?? []).find(
      (r) => r.id === resourceId || r.slug === resourceId,
    );
    if (found?.slug) return found.slug;
    return resourceId;
  }

  async listResources(): Promise<SchemaResource[]> {
    return this.ensureTypes();
  }

  async getResource(id: string): Promise<SchemaResource | null> {
    const types = await this.ensureTypes();
    const hit = types.find((r) => r.id === id || r.slug === id);
    if (hit?.schema && Object.keys(hit.schema).length > 0) return hit;
    const slug = await this.resolveSlug(id);
    try {
      const full = await this.client.recordTypes.get(slug);
      const mapped = mapResource(full);
      this.slugById.set(mapped.id, mapped.slug ?? slug);
      if (mapped.slug) this.slugById.set(mapped.slug, mapped.slug);
      // refresh cache entry
      const nextTypes = types.map((t) =>
        t.id === mapped.id || t.slug === mapped.slug ? mapped : t,
      );
      if (!nextTypes.some((t) => t.id === mapped.id)) {
        nextTypes.push(mapped);
      }
      this.typeCache = nextTypes;
      return mapped;
    } catch {
      return hit ?? null;
    }
  }

  async listRecords(resourceId: string, query?: ListRecordsQuery): Promise<ListRecordsResult> {
    const slug = await this.resolveSlug(resourceId);
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 25;
    let req = this.client.cma.recordType(slug).page(page).pageSize(pageSize);
    if (query?.sortField) {
      req = req.orderBy(query.sortField, query.sortDir === 'desc' ? 'desc' : 'asc');
    }
    if (query?.filters) {
      for (const [field, value] of Object.entries(query.filters)) {
        if (!value) continue;
        req = req.where(field, 'eq', value);
      }
    }
    const res = await req.get();
    let rows = (Array.isArray(res.data) ? res.data : []).map(mapRecord).filter((r) => r.id);
    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
    }
    const total =
      query?.search?.trim()
        ? rows.length
        : res.pagination?.total ?? (res as any).meta?.total ?? rows.length;
    return {
      records: rows,
      total: Number(total) || rows.length,
      page,
      pageSize,
    };
  }

  async getRecord(resourceId: string, recordId: string): Promise<SchemaRecord | null> {
    const slug = await this.resolveSlug(resourceId);
    const raw = await this.client.records.get(slug, recordId);
    if (!raw) return null;
    return mapRecord(raw);
  }

  async createRecord(resourceId: string, data: Record<string, unknown>): Promise<SchemaRecord> {
    const slug = await this.resolveSlug(resourceId);
    const created = await this.client.records.create(slug, { data } as any);
    return mapRecord(created);
  }

  async updateRecord(
    resourceId: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<SchemaRecord> {
    const slug = await this.resolveSlug(resourceId);
    const updated = await this.client.records.update(slug, recordId, { data } as any);
    return mapRecord(updated);
  }

  async publishRecord(resourceId: string, recordId: string): Promise<SchemaRecord> {
    const slug = await this.resolveSlug(resourceId);
    const published = await this.client.records.publish(slug, recordId);
    return mapRecord(published);
  }

  async unpublishRecord(resourceId: string, recordId: string): Promise<SchemaRecord> {
    const slug = await this.resolveSlug(resourceId);
    const unpublished = await this.client.records.unpublish(slug, recordId);
    return mapRecord(unpublished);
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

export async function createBrightsyDatasource(): Promise<BrightsyDatasource> {
  const auth = await window.sideboard.getBrightsyCmsAuth();
  if (!auth?.accessToken || !auth.accountId) {
    throw new Error(auth?.reason || 'Brightsy not logged in — connect a team in Settings');
  }
  return new BrightsyDatasource({
    endpoint: auth.endpoint,
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    accountSlug: auth.accountSlug,
  });
}
