import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { httpFetch } from '../http/fetch.js';
import { normalizeServiceOrigin } from '../integrations/optional-services.js';
import { loadAppSettings } from '../store/app-settings.js';
import { mcpJson } from './issue-list.js';

const POSTHOG_METHODS = ['GET', 'POST', 'PATCH'] as const;
export type PosthogApiMethod = (typeof POSTHOG_METHODS)[number];

/** Cap the raw response before it becomes a tool result. Clip still spills oversized text. */
const POSTHOG_RESPONSE_MAX_CHARS = 256_000;
const POSTHOG_TIMEOUT_MS = 20_000;

export type PosthogApiInput = {
  method: PosthogApiMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  write?: boolean;
};

/**
 * HogQL and insight queries. `POST /api/projects/:id/query/` reads analytics
 * and does not change the project, so it does not need `write=true`.
 */
export function isPosthogReadQuery(method: string, path: string): boolean {
  if (method !== 'POST') return false;
  const raw = path.trim().replace(/\/+$/, '');
  return /^\/api\/projects\/[^/]+\/query$/.test(raw);
}

/**
 * PostHog path on the connected host. Rejects absolute URLs and `..` so the
 * stored key cannot be sent anywhere else.
 */
export function posthogApiUrl(
  host: string,
  path: string,
  query?: Record<string, string>,
): string {
  const raw = path.trim();
  if (!raw.startsWith('/api/')) {
    throw new Error('path must start with /api/');
  }
  if (raw.includes('://') || raw.startsWith('//') || /[?#\s\\]/.test(raw) || raw.includes('..')) {
    throw new Error('path must be a PostHog API path, not a URL');
  }
  const origin = normalizeServiceOrigin(host, 'https://us.posthog.com');
  const url = new URL(raw, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/')) {
    throw new Error('path must stay on the connected PostHog host');
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (!key.trim()) throw new Error('query keys must be non-empty');
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function runPosthogApi(input: PosthogApiInput) {
  const method = input.method;
  if (!POSTHOG_METHODS.includes(method)) {
    return mcpJson({ ok: false, error: 'method must be GET, POST, or PATCH' }, true);
  }
  if (method !== 'GET' && input.write !== true && !isPosthogReadQuery(method, input.path)) {
    return mcpJson(
      {
        ok: false,
        error:
          'POST and PATCH require write=true, and only when the user asked to change PostHog data. POST /api/projects/:id/query/ is a read and does not need write=true.',
      },
      true,
    );
  }
  if (method === 'GET' && input.body !== undefined) {
    return mcpJson({ ok: false, error: 'GET does not take a body' }, true);
  }

  const integrations = loadAppSettings().integrations;
  const token = integrations.posthogPersonalApiKey?.trim();
  if (!token) {
    return mcpJson(
      { ok: false, error: 'PostHog is not connected (Settings → Connectors).' },
      true,
    );
  }

  let url: string;
  try {
    url = posthogApiUrl(
      integrations.posthogHost || 'https://us.posthog.com',
      input.path,
      input.query,
    );
  } catch (err) {
    return mcpJson(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      true,
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (input.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
  }

  try {
    const res = await httpFetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
    });
    const text = await res.text();
    const truncated = text.length > POSTHOG_RESPONSE_MAX_CHARS;
    const slice = truncated ? text.slice(0, POSTHOG_RESPONSE_MAX_CHARS) : text;
    let parsed: unknown = slice;
    if (slice.trim()) {
      try {
        parsed = JSON.parse(slice) as unknown;
      } catch {
        parsed = slice;
      }
    } else {
      parsed = null;
    }
    return mcpJson(
      {
        ok: res.ok,
        status: res.status,
        ...(truncated ? { truncated: true } : {}),
        body: parsed,
      },
      !res.ok,
    );
  } catch (err) {
    return mcpJson(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      true,
    );
  }
}

const POSTHOG_API_DESCRIPTION =
  'Call the connected PostHog project (Settings → Connectors). path must start with /api/ and is joined to the stored host. GET is the default. POST /api/projects/:id/query/ is a read (HogQL and insights) and does not need write=true. Other POST and PATCH require write=true, and only when the user asked to change PostHog data. The API key is not in the environment. Do not sign in to a PostHog MCP.';

export function registerPosthogTools(server: McpServer): void {
  server.tool(
    'posthog_api',
    POSTHOG_API_DESCRIPTION,
    {
      method: z
        .enum(POSTHOG_METHODS)
        .describe(
          'GET, POST /api/projects/:id/query/ for a read, or POST/PATCH when the user asked for a change',
        ),
      path: z.string().describe('PostHog path starting with /api/, not a full URL'),
      query: z
        .record(z.string(), z.string())
        .optional()
        .describe('Query string parameters'),
      body: z.unknown().optional().describe('JSON body for POST or PATCH'),
      write: z
        .boolean()
        .optional()
        .describe(
          'Required true for POST and PATCH that change data. Omit for GET and for POST /api/projects/:id/query/.',
        ),
    },
    async (input) => runPosthogApi(input),
  );
}
