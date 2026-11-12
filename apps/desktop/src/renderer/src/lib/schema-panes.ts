import type { MessagePart } from '@sideboard-ai/core';
import { flattenToolInput, toolShortName, unwrapToolResultPayload } from './artifacts';
import type {
  SchemaContentState,
  SchemaDatasourceKind,
  SchemaPaneContent,
  SchemaPaneMode,
  SchemaRecord,
  SchemaResource,
} from './right-pane';

export function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export function parseMaybeJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function parseContentStates(raw: unknown): SchemaContentState[] | undefined {
  const list = Array.isArray(raw) ? raw : undefined;
  if (!list?.length) return undefined;
  const states = list
    .map((s) => String(s).toLowerCase())
    .filter((s): s is SchemaContentState => s === 'draft' || s === 'published');
  return states.length ? states : undefined;
}

function parseSchemaResource(raw: unknown, fallbackId: string, fallbackTitle: string): SchemaResource | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const schema = asRecord(rec.schema) ?? asRecord(rec.json_schema);
  if (!schema) return undefined;
  const schemaUi =
    asRecord(rec.schemaUi) ??
    asRecord(rec.schema_ui) ??
    asRecord(schema.schema_ui) ??
    asRecord(schema.schemaUi);
  const contentStates =
    parseContentStates(rec.contentStates) ??
    parseContentStates(rec.content_states) ??
    parseContentStates(schemaUi?.['ui:contentStates']);
  return {
    id: str(rec.id) ?? str(rec.resource_id) ?? fallbackId,
    title: str(rec.title) ?? str(rec.name) ?? fallbackTitle,
    slug: str(rec.slug) ?? str(rec.name),
    schema,
    schemaUi,
    contentStates,
  };
}

function parseSchemaRecord(raw: unknown, fallbackId?: string): SchemaRecord | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const id = str(rec.id) ?? str(rec.record_id) ?? fallbackId;
  if (!id) return undefined;
  const data =
    asRecord(rec.data) ??
    asRecord(rec.fields) ??
    (asRecord(rec.content) ? (rec.content as Record<string, unknown>) : undefined) ??
    // Treat remaining keys as data if nested data missing
    Object.fromEntries(
      Object.entries(rec).filter(
        ([k]) =>
          !['id', 'record_id', 'published_at', 'publishedAt', 'updated_at', 'updatedAt', 'created_at', 'createdAt'].includes(
            k,
          ),
      ),
    );
  return {
    id,
    data: data ?? {},
    publishedAt: (str(rec.published_at) ?? str(rec.publishedAt) ?? null) as string | null,
    updatedAt: str(rec.updated_at) ?? str(rec.updatedAt) ?? null,
    createdAt: str(rec.created_at) ?? str(rec.createdAt) ?? null,
  };
}

/** Extract schema pane payloads from present_schema tool parts. */
export function extractSchemaPanes(parts: MessagePart[] | undefined): SchemaPaneContent[] {
  if (!parts?.length) return [];
  const out: SchemaPaneContent[] = [];
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const rawInput = asRecord(part.input);
    const shortName = toolShortName(part.name, rawInput);
    if (!/present_schema$/i.test(shortName)) continue;

    const input = flattenToolInput(rawInput);
    const result = asRecord(unwrapToolResultPayload(part.result));
    const wrapped = asRecord(result?.data) ?? result ?? input;
    if (!wrapped && !input) continue;

    const merged = { ...asRecord(wrapped), ...asRecord(input) } as Record<string, unknown>;
    const paneId =
      str(merged.pane_id) ??
      str(merged.schema_id) ??
      str(merged.id) ??
      part.id;
    const title = str(merged.title) ?? 'Schema';
    const modeRaw = str(merged.mode)?.toLowerCase();
    const mode: SchemaPaneMode = modeRaw === 'form' ? 'form' : 'table';
    const datasource: SchemaDatasourceKind =
      str(merged.datasource)?.toLowerCase() === 'inline' ? 'inline' : 'brightsy';

    const resource =
      parseSchemaResource(merged.resource, paneId, title) ??
      (asRecord(merged.schema)
        ? parseSchemaResource(
            {
              id: str(merged.resource_id) ?? paneId,
              title,
              schema: merged.schema,
              schemaUi: merged.schemaUi ?? merged.schema_ui,
              slug: merged.slug,
            },
            paneId,
            title,
          )
        : undefined);

    const resourceId = str(merged.resource_id) ?? resource?.id;
    const recordId = str(merged.record_id) ?? null;
    const record = parseSchemaRecord(merged.record, recordId ?? undefined);
    let records: SchemaRecord[] | undefined;
    if (Array.isArray(merged.records)) {
      records = merged.records
        .map((r) => parseSchemaRecord(r))
        .filter((r): r is SchemaRecord => Boolean(r));
    }

    // Brightsy mode needs resource_id; inline needs embedded resource.
    if (datasource === 'brightsy' && !resourceId && !resource) continue;
    if (datasource === 'inline' && !resource) continue;

    out.push({
      kind: 'schema',
      id: `schema-${paneId}`,
      title,
      mode: record || recordId ? 'form' : mode,
      datasource,
      resourceId: resourceId ?? resource?.id,
      recordId: record?.id ?? recordId,
      resource,
      records,
      record,
      source: 'tool',
    });
  }
  return out;
}
