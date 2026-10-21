/**
 * Pure MCP Apps / MCP-UI parsing. No Node or SDK imports — the desktop
 * renderer loads this file through a Vite alias.
 */

export type McpUiCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

export type McpUiView = {
  server: string;
  tool: string;
  uri: string;
  mimeType: string;
  html: string;
  /** Content-Security-Policy header value for the sandboxed frame. */
  csp: string;
};

export type McpServerLaunch =
  | {
      kind: 'stdio';
      command: string;
      args: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | { kind: 'http' | 'sse'; url: string; headers?: Record<string, string> };

const HTML_MAX = 1_500_000;

export function mcpUiFrameId(toolCallId: string): string {
  let h = 2166136261;
  for (let i = 0; i < toolCallId.length; i++) {
    h ^= toolCallId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `mcpui-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** `mcp__<server>__<tool>` using the longest configured server name. */
export function matchClaudeMcpTool(
  toolName: string,
  serverNames: readonly string[],
): { server: string; tool: string } | null {
  const name = toolName.trim();
  if (!name.startsWith('mcp__')) return null;
  const ranked = [...serverNames].filter((s) => s.trim()).sort((a, b) => b.length - a.length);
  for (const server of ranked) {
    const prefix = `mcp__${server}__`;
    if (!name.startsWith(prefix)) continue;
    const tool = name.slice(prefix.length).trim();
    if (!tool) continue;
    return { server, tool };
  }
  return null;
}

export function parseMcpServerLaunch(entry: Record<string, unknown>): McpServerLaunch | null {
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  if (command) {
    const args = Array.isArray(entry.args)
      ? entry.args.filter((a): a is string => typeof a === 'string')
      : [];
    const env = stringRecord(entry.env);
    const cwd = typeof entry.cwd === 'string' && entry.cwd.trim() ? entry.cwd.trim() : undefined;
    return {
      kind: 'stdio',
      command,
      args,
      ...(env ? { env } : {}),
      ...(cwd ? { cwd } : {}),
    };
  }
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
  const headers = stringRecord(entry.headers);
  return {
    kind: type === 'sse' ? 'sse' : 'http',
    url: parsed.toString(),
    ...(headers ? { headers } : {}),
  };
}

export function uiResourceUriFromMeta(meta: unknown): string | null {
  const rec = asRecord(meta);
  const nested = asRecord(rec.ui);
  const fromNested = typeof nested.resourceUri === 'string' ? nested.resourceUri.trim() : '';
  const legacy = typeof rec['ui/resourceUri'] === 'string' ? rec['ui/resourceUri'].trim() : '';
  const uri = fromNested || legacy;
  return uri.startsWith('ui://') ? uri : null;
}

export function cspFromMeta(meta: unknown): McpUiCsp | undefined {
  const ui = asRecord(asRecord(meta).ui);
  const csp = asRecord(ui.csp);
  const connectDomains = originList(csp.connectDomains);
  const resourceDomains = originList(csp.resourceDomains);
  const frameDomains = originList(csp.frameDomains);
  const baseUriDomains = originList(csp.baseUriDomains);
  if (
    !connectDomains?.length &&
    !resourceDomains?.length &&
    !frameDomains?.length &&
    !baseUriDomains?.length
  ) {
    return undefined;
  }
  return {
    ...(connectDomains?.length ? { connectDomains } : {}),
    ...(resourceDomains?.length ? { resourceDomains } : {}),
    ...(frameDomains?.length ? { frameDomains } : {}),
    ...(baseUriDomains?.length ? { baseUriDomains } : {}),
  };
}

export function htmlFromResourceContent(content: {
  uri?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}): { uri: string; mimeType: string; html: string } | null {
  const uri = content.uri?.trim() ?? '';
  if (!uri.startsWith('ui://')) return null;
  const mimeType = content.mimeType?.trim() || 'text/html';
  if (!isHtmlMime(mimeType)) return null;
  const html = htmlText(content.text, content.blob);
  if (!html) return null;
  return { uri, mimeType, html };
}

/** Inline `ui://` HTML when a tool result already carries the resource. */
export function embeddedMcpUiFromText(text: string | undefined): {
  uri: string;
  mimeType: string;
  html: string;
  csp?: McpUiCsp;
} | null {
  if (!text || text.length > HTML_MAX) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  return findEmbedded(parsed, 0);
}

/**
 * Claude Code hands the host the tool's structured payload as a string.
 * Apps read `structuredContent` when that string is a JSON object.
 */
export function agentTextToCallToolResult(
  text: string | undefined,
  isError = false,
): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
} {
  const body = text ?? '';
  const trimmed = body.trim();
  let structuredContent: Record<string, unknown> | undefined;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        structuredContent = parsed as Record<string, unknown>;
      }
    } catch {
      structuredContent = undefined;
    }
  }
  return {
    content: [{ type: 'text', text: body }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

/** Restrictive MCP Apps CSP, plus origins declared on the resource. */
export function mcpUiContentSecurityPolicy(csp?: McpUiCsp): string {
  const resource = (csp?.resourceDomains ?? []).join(' ');
  const connect = (csp?.connectDomains ?? []).join(' ');
  const frames = csp?.frameDomains?.length ? csp.frameDomains.join(' ') : "'none'";
  const base = csp?.baseUriDomains?.length ? csp.baseUriDomains.join(' ') : "'none'";
  const connectSrc = connect ? `'self' ${connect}`.trim() : "'none'";
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${resource}`.trim(),
    `style-src 'self' 'unsafe-inline' ${resource}`.trim(),
    `img-src 'self' data: ${resource}`.trim(),
    `font-src 'self' ${resource}`.trim(),
    `connect-src ${connectSrc}`,
    `media-src 'self' data: ${resource}`.trim(),
    `frame-src ${frames}`,
    `base-uri ${base}`,
    "object-src 'none'",
  ].join('; ');
}

function findEmbedded(
  value: unknown,
  depth: number,
): { uri: string; mimeType: string; html: string; csp?: McpUiCsp } | null {
  if (depth > 6 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEmbedded(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const rec = value as Record<string, unknown>;
  const resource = asRecord(rec.resource);
  const direct = htmlFromResourceContent({
    uri: typeof rec.uri === 'string' ? rec.uri : typeof resource.uri === 'string' ? resource.uri : undefined,
    mimeType:
      typeof rec.mimeType === 'string'
        ? rec.mimeType
        : typeof resource.mimeType === 'string'
          ? resource.mimeType
          : undefined,
    text: typeof rec.text === 'string' ? rec.text : typeof resource.text === 'string' ? resource.text : undefined,
    blob: typeof rec.blob === 'string' ? rec.blob : typeof resource.blob === 'string' ? resource.blob : undefined,
  });
  if (direct) {
    const csp = cspFromMeta(rec._meta) ?? cspFromMeta(resource._meta);
    return { ...direct, ...(csp ? { csp } : {}) };
  }
  for (const child of Object.values(rec)) {
    const found = findEmbedded(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function htmlText(text: string | undefined, blob: string | undefined): string | null {
  if (typeof text === 'string' && text.trim()) {
    return text.length <= HTML_MAX ? text : null;
  }
  if (typeof blob !== 'string' || !blob.trim()) return null;
  try {
    const decoded = decodeBase64(blob.trim());
    if (!decoded.trim() || decoded.length > HTML_MAX) return null;
    return decoded;
  } catch {
    return null;
  }
}

function decodeBase64(blob: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(blob, 'base64').toString('utf8');
  const bin = atob(blob);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isHtmlMime(mime: string): boolean {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'text/html';
}

function originList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const origin = originToken(item);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

function originToken(value: string): string | null {
  const trimmed = value.trim();
  if (/^(https?|wss?):\/\/\*\.[a-z0-9.-]+(?::\d+)?$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const rec = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(rec)) {
    if (typeof item === 'string') out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
