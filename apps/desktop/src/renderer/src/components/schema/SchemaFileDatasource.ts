/**
 * Source-agnostic file storage for CMS TipTap / file fields.
 * Brightsy client and agent/MCP tools implement the same surface.
 */

export interface SchemaFileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  contentType?: string;
  url?: string | null;
  updatedAt?: string | null;
}

export interface SchemaFileDatasource {
  readonly kind: 'brightsy' | 'agent' | 'memory';
  list(params?: { path?: string; search?: string }): Promise<SchemaFileEntry[]>;
  upload(params: {
    path?: string;
    filename: string;
    file: Blob | File;
    contentType?: string;
  }): Promise<{ path: string; fileUrl: string }>;
  getSignedUrl(params: { path: string; expiresIn?: number }): Promise<string>;
  createFolder(params: { path?: string; folderName: string }): Promise<void>;
  delete(path: string): Promise<void>;
  move(path: string, newPath: string): Promise<void>;
}

/** Text rewriting for TipTap AI tools — agent or Brightsy complete. */
export interface SchemaAIDatasource {
  readonly kind: 'brightsy' | 'agent';
  completeText(opts: {
    instruction: string;
    text: string;
  }): Promise<string>;
}

function basename(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}

function isFolder(entry: Record<string, unknown>): boolean {
  if (entry.type === 'folder' || entry.is_folder === true) return true;
  if (entry.type === 'file') return false;
  // Brightsy list often marks folders with trailing slash or missing content_type
  const path = String(entry.path ?? '');
  return path.endsWith('/') || (!entry.content_type && !entry.size && !entry.url);
}

function mapEntry(raw: Record<string, unknown>): SchemaFileEntry {
  const path = String(raw.path ?? raw.name ?? '');
  const folder = isFolder(raw);
  return {
    name: String(raw.name ?? basename(path.replace(/\/$/, ''))),
    path: path.replace(/\/$/, ''),
    type: folder ? 'folder' : 'file',
    size: typeof raw.size === 'number' ? raw.size : undefined,
    contentType:
      typeof raw.content_type === 'string'
        ? raw.content_type
        : typeof raw.contentType === 'string'
          ? raw.contentType
          : typeof raw.mime_type === 'string'
            ? raw.mime_type
            : undefined,
    url:
      typeof raw.url === 'string'
        ? raw.url
        : typeof raw.fileUrl === 'string'
          ? raw.fileUrl
          : null,
    updatedAt:
      typeof raw.updated_at === 'string'
        ? raw.updated_at
        : typeof raw.updatedAt === 'string'
          ? raw.updatedAt
          : null,
  };
}

/** Brightsy account storage via @brightsy/client (same ops as MCP list_files / upload_file). */
export class BrightsyFileDatasource implements SchemaFileDatasource {
  readonly kind = 'brightsy' as const;
  constructor(private client: import('@brightsy/client').BrightsyClient) {}

  async list(params?: { path?: string; search?: string }): Promise<SchemaFileEntry[]> {
    const rows = await this.client.files.list(params);
    return (Array.isArray(rows) ? rows : []).map((r) => mapEntry(r as Record<string, unknown>));
  }

  async upload(params: {
    path?: string;
    filename: string;
    file: Blob | File;
    contentType?: string;
  }): Promise<{ path: string; fileUrl: string }> {
    const result = await this.client.files.upload({
      path: params.path,
      filename: params.filename,
      file: params.file,
    });
    return {
      path: String(result.path ?? `${params.path ?? ''}/${params.filename}`),
      fileUrl: String(result.fileUrl ?? result.url ?? ''),
    };
  }

  async getSignedUrl(params: { path: string; expiresIn?: number }): Promise<string> {
    const result = await this.client.files.signedUrl(params);
    const url =
      (result as { signedUrl?: string; url?: string })?.signedUrl ??
      (result as { url?: string })?.url;
    if (!url) throw new Error('No signed URL returned');
    return url;
  }

  async createFolder(params: { path?: string; folderName: string }): Promise<void> {
    await this.client.files.createFolder(params);
  }

  async delete(path: string): Promise<void> {
    await this.client.files.delete(path);
  }

  async move(path: string, newPath: string): Promise<void> {
    await this.client.files.move(path, newPath);
  }
}

/**
 * Handler-backed datasource — wire to agent/MCP tools (list_files, upload_file, …)
 * so file UI stays source-agnostic like SchemaDatasource.
 */
export class HandlerFileDatasource implements SchemaFileDatasource {
  readonly kind: 'agent' | 'memory';
  constructor(
    private handlers: SchemaFileDatasource,
    kind: 'agent' | 'memory' = 'agent',
  ) {
    this.kind = kind;
  }

  list(params?: { path?: string; search?: string }) {
    return this.handlers.list(params);
  }
  upload(params: {
    path?: string;
    filename: string;
    file: Blob | File;
    contentType?: string;
  }) {
    return this.handlers.upload(params);
  }
  getSignedUrl(params: { path: string; expiresIn?: number }) {
    return this.handlers.getSignedUrl(params);
  }
  createFolder(params: { path?: string; folderName: string }) {
    return this.handlers.createFolder(params);
  }
  delete(path: string) {
    return this.handlers.delete(path);
  }
  move(path: string, newPath: string) {
    return this.handlers.move(path, newPath);
  }
}

/** In-memory files for inline/demo forms (no Brightsy). */
export class MemoryFileDatasource implements SchemaFileDatasource {
  readonly kind = 'memory' as const;
  private files = new Map<string, SchemaFileEntry & { blob?: Blob }>();

  async list(params?: { path?: string; search?: string }): Promise<SchemaFileEntry[]> {
    const prefix = (params?.path ?? '').replace(/\/$/, '');
    const q = params?.search?.trim().toLowerCase();
    return [...this.files.values()]
      .filter((f) => {
        const parent = f.path.includes('/')
          ? f.path.slice(0, f.path.lastIndexOf('/'))
          : '';
        if (prefix && parent !== prefix) return false;
        if (!prefix && parent) return false;
        if (q && !f.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .map(({ blob: _b, ...entry }) => entry);
  }

  async upload(params: {
    path?: string;
    filename: string;
    file: Blob | File;
  }): Promise<{ path: string; fileUrl: string }> {
    const path = [params.path?.replace(/\/$/, ''), params.filename].filter(Boolean).join('/');
    const fileUrl = URL.createObjectURL(params.file);
    this.files.set(path, {
      name: params.filename,
      path,
      type: 'file',
      size: params.file.size,
      contentType: params.file.type || undefined,
      url: fileUrl,
      blob: params.file,
    });
    return { path, fileUrl };
  }

  async getSignedUrl(params: { path: string }): Promise<string> {
    const hit = this.files.get(params.path);
    if (!hit?.url) throw new Error(`File not found: ${params.path}`);
    return hit.url;
  }

  async createFolder(params: { path?: string; folderName: string }): Promise<void> {
    const path = [params.path?.replace(/\/$/, ''), params.folderName]
      .filter(Boolean)
      .join('/');
    this.files.set(path, {
      name: params.folderName,
      path,
      type: 'folder',
    });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async move(path: string, newPath: string): Promise<void> {
    const hit = this.files.get(path);
    if (!hit) throw new Error(`File not found: ${path}`);
    this.files.delete(path);
    this.files.set(newPath, {
      ...hit,
      path: newPath,
      name: basename(newPath),
    });
  }
}

export class BrightsyAIDatasource implements SchemaAIDatasource {
  readonly kind = 'brightsy' as const;
  constructor(
    private client: import('@brightsy/client').BrightsyClient,
    private accountId: string,
  ) {}

  async completeText(opts: { instruction: string; text: string }): Promise<string> {
    const response: any = await this.client.agent('default').complete({
      messages: [
        {
          role: 'system',
          content:
            'You are a text processing assistant. Return ONLY the processed text with no commentary.',
        },
        {
          role: 'user',
          content: `${opts.instruction}\n\n${opts.text}`,
        },
      ],
      stream: false,
      accountId: this.accountId,
    });
    const content =
      response?.content ??
      response?.choices?.[0]?.message?.content ??
      response?.data?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI returned empty content');
    }
    return content.trim();
  }
}

export async function createBrightsyFileDatasource(): Promise<BrightsyFileDatasource> {
  const { BrightsyClient } = await import('@brightsy/client');
  const auth = await window.sideboard.getBrightsyCmsAuth();
  if (!auth?.accessToken || !auth.accountId) {
    throw new Error(auth?.reason || 'Brightsy not logged in');
  }
  const client = new BrightsyClient({
    endpoint: auth.endpoint,
    account_id: auth.accountId,
    authMode: 'oauth',
    oauthAccessToken: auth.accessToken,
  });
  return new BrightsyFileDatasource(client);
}

export async function createBrightsyAIDatasource(): Promise<BrightsyAIDatasource> {
  const { BrightsyClient } = await import('@brightsy/client');
  const auth = await window.sideboard.getBrightsyCmsAuth();
  if (!auth?.accessToken || !auth.accountId) {
    throw new Error(auth?.reason || 'Brightsy not logged in');
  }
  const client = new BrightsyClient({
    endpoint: auth.endpoint,
    account_id: auth.accountId,
    authMode: 'oauth',
    oauthAccessToken: auth.accessToken,
  });
  return new BrightsyAIDatasource(client, auth.accountId);
}
