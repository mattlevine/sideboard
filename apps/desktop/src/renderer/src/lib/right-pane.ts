import type { MessagePart } from '@sideboard-ai/core';
import {
  extractArtifacts,
  latestArtifact,
  type ChatArtifact,
} from './artifacts';

export type { ChatArtifact };

/**
 * Lifecycle states for sendable content (e.g. Brightsy draft → published).
 * When absent / empty, the form is save-only — no Publish/Unpublish UI.
 */
export type SchemaContentState = 'draft' | 'published';

/** Datasource-agnostic schema resource (Brightsy record type is one provider). */
export interface SchemaResource {
  id: string;
  title: string;
  /** Slug or alternate key when the backend needs it (e.g. Brightsy record type slug). */
  slug?: string;
  schema: Record<string, unknown>;
  schemaUi?: Record<string, unknown>;
  /**
   * When set (e.g. `['draft','published']`), Save and Publish are separate
   * actions — matching Brightsy MCP update + publish. Omit for plain records.
   */
  contentStates?: SchemaContentState[];
}

/** True when the resource has a draft/published (or similar) send lifecycle. */
export function resourceHasContentStates(
  resource: SchemaResource | null | undefined,
): boolean {
  const states = resource?.contentStates;
  if (!states?.length) {
    const ui = resource?.schemaUi?.['ui:contentStates'];
    if (Array.isArray(ui) && ui.length > 0) return true;
    return false;
  }
  return states.length > 1 || states.includes('published');
}

export interface SchemaRecord {
  id: string;
  data: Record<string, unknown>;
  publishedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export type SchemaPaneMode = 'table' | 'form';
export type SchemaDatasourceKind = 'brightsy' | 'inline';

export interface SchemaPaneContent {
  kind: 'schema';
  id: string;
  title: string;
  mode: SchemaPaneMode;
  datasource: SchemaDatasourceKind;
  resourceId?: string;
  recordId?: string | null;
  /** Inline resource definition when datasource is inline (or prefetched). */
  resource?: SchemaResource;
  /** Inline records for table mode without a live backend. */
  records?: SchemaRecord[];
  /** Inline record for form mode. */
  record?: SchemaRecord;
  source: 'fence' | 'tool';
}

export type FilesDatasourceKind = 'brightsy' | 'memory';

/** Sideboard Files column (CMS file manager), opened via present_files. */
export interface FilesPaneContent {
  kind: 'files';
  id: string;
  title: string;
  datasource: FilesDatasourceKind;
  path?: string;
  source: 'fence' | 'tool';
}

export type DocumentPaneContent = ChatArtifact & { pane: 'document' };
export type RightPaneContent =
  | (ChatArtifact & { pane?: 'document' })
  | SchemaPaneContent
  | FilesPaneContent;

export function isSchemaPane(content: RightPaneContent | null | undefined): content is SchemaPaneContent {
  return Boolean(content && (content as SchemaPaneContent).kind === 'schema');
}

export function isFilesPane(content: RightPaneContent | null | undefined): content is FilesPaneContent {
  return Boolean(content && (content as FilesPaneContent).kind === 'files');
}

export function isDocumentPane(
  content: RightPaneContent | null | undefined,
): content is ChatArtifact {
  return Boolean(content && !isSchemaPane(content) && !isFilesPane(content));
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function parseMaybeJson(input: unknown): unknown {
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
    const shortName = part.name.replace(/^mcp__[^_]+__/, '').replace(/^mcp__/, '');
    if (!/^present_schema$/i.test(shortName)) continue;

    const input = asRecord(part.input);
    const result = asRecord(parseMaybeJson(part.result));
    const wrapped = asRecord(result?.data) ?? result ?? input;
    if (!wrapped && !input) continue;

    const src = input ?? wrapped ?? {};
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

/** Extract Files column payloads from present_files tool parts. */
export function extractFilesPanes(parts: MessagePart[] | undefined): FilesPaneContent[] {
  if (!parts?.length) return [];
  const out: FilesPaneContent[] = [];
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const shortName = part.name.replace(/^mcp__[^_]+__/, '').replace(/^mcp__/, '');
    if (!/^present_files$/i.test(shortName)) continue;

    const input = asRecord(part.input);
    const result = asRecord(parseMaybeJson(part.result));
    const wrapped = asRecord(result?.data) ?? result ?? input;
    const merged = { ...asRecord(wrapped), ...asRecord(input) } as Record<string, unknown>;
    const paneId = str(merged.pane_id) ?? str(merged.id) ?? part.id;
    const title = str(merged.title) ?? 'Files';
    const dsRaw = str(merged.datasource)?.toLowerCase();
    const datasource: FilesDatasourceKind = dsRaw === 'memory' ? 'memory' : 'brightsy';
    out.push({
      kind: 'files',
      id: `files-${paneId}`,
      title,
      datasource,
      path: str(merged.path),
      source: 'tool',
    });
  }
  return out;
}

const SCHEMA_FENCE_RE = /```schema[^\n]*\n([\s\S]*?)(?:```|$)/gi;

/** Extract ```schema fences (JSON payload matching present_schema shape). */
export function extractSchemaFencePanes(text: string, idPrefix = 'schema-fence'): SchemaPaneContent[] {
  if (!text || !/```schema/i.test(text)) return [];
  const out: SchemaPaneContent[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(SCHEMA_FENCE_RE.source, SCHEMA_FENCE_RE.flags);
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    const raw = (match[1] ?? '').trim();
    if (!raw) {
      index += 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      index += 1;
      continue;
    }
    const fakeParts: MessagePart[] = [
      {
        type: 'tool',
        id: `${idPrefix}-${index}`,
        name: 'present_schema',
        status: 'done',
        input: asRecord(parsed) ?? { title: 'Schema', mode: 'table', datasource: 'inline' },
      },
    ];
    out.push(...extractSchemaPanes(fakeParts).map((p) => ({ ...p, source: 'fence' as const })));
    index += 1;
  }
  return out;
}

/** Document artifacts + schema + files panes from a turn. */
export function extractRightPaneContents(
  text: string,
  parts?: MessagePart[],
  idPrefix = 'fence',
): RightPaneContent[] {
  const toolPanes: RightPaneContent[] = [];
  for (const part of parts ?? []) {
    toolPanes.push(...extractFilesPanes([part]));
    toolPanes.push(...extractSchemaPanes([part]));
  }
  const schemas = [
    ...toolPanes,
    ...extractSchemaFencePanes(
      parts
        ?.filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n') || text,
      idPrefix.replace('fence', 'schema-fence'),
    ),
  ];
  const docs = extractArtifacts(text, parts, idPrefix);
  return [...schemas, ...docs];
}

/** Newest right-pane payload (files/schema tools beat document artifacts). */
export function latestRightPaneContent(
  text: string,
  parts?: MessagePart[],
  idPrefix = 'fence',
): RightPaneContent | null {
  const toolPanes: RightPaneContent[] = [];
  for (const part of parts ?? []) {
    toolPanes.push(...extractFilesPanes([part]));
    toolPanes.push(...extractSchemaPanes([part]));
  }
  const panes = [
    ...toolPanes,
    ...extractSchemaFencePanes(
      parts
        ?.filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n') || text,
      idPrefix.replace(/^fence/, 'schema-fence').replace(/^live$/, 'schema-live').replace(/^msg-/, 'schema-msg-'),
    ),
  ];
  if (panes.length) return panes[panes.length - 1]!;
  return latestArtifact(text, parts, idPrefix);
}
