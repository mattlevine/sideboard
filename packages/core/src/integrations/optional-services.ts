import { httpFetch } from '../http/fetch.js';
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
  type IntegrationsSettings,
} from '../store/app-settings.js';

export const OPTIONAL_SERVICE_IDS = ['vercel', 'supabase', 'posthog', 'sentry'] as const;

export type OptionalServiceId = (typeof OPTIONAL_SERVICE_IDS)[number];

export interface OptionalServiceSpec {
  id: OptionalServiceId;
  label: string;
  /** One-line why / when to turn this on. */
  hint: string;
  tokenPlaceholder: string;
  tokenDocs: string;
  /** Env key injected into worktree agent runs when connected. */
  envKey: string;
  /** Official CLI to prefer (`vercel`, `supabase`, `sentry-cli`). Omit when there is none. */
  cli?: string;
  /** npm package for Settings → Connectors **Install CLI** (`npm i -g`). */
  npmPackage?: string;
  /** Optional host env key (PostHog / Sentry self-host). */
  hostEnvKey?: string;
  defaultHost?: string;
  hostPlaceholder?: string;
}

export const OPTIONAL_SERVICES: readonly OptionalServiceSpec[] = [
  {
    id: 'vercel',
    label: 'Vercel',
    hint: 'Deploys and project settings. Agents use the `vercel` CLI (`VERCEL_TOKEN`).',
    tokenPlaceholder: 'token from vercel.com/account/tokens',
    tokenDocs: 'https://vercel.com/account/tokens',
    envKey: 'VERCEL_TOKEN',
    cli: 'vercel',
    npmPackage: 'vercel',
  },
  {
    id: 'supabase',
    label: 'Supabase',
    hint: 'Database and project management. Agents use the `supabase` CLI (`SUPABASE_ACCESS_TOKEN`).',
    tokenPlaceholder: 'sbp_…',
    tokenDocs: 'https://supabase.com/dashboard/account/tokens',
    envKey: 'SUPABASE_ACCESS_TOKEN',
    cli: 'supabase',
    npmPackage: 'supabase',
  },
  {
    id: 'posthog',
    label: 'PostHog',
    hint: 'Product analytics. No first-class CLI — agents use the HTTP API (`POSTHOG_PERSONAL_API_KEY`).',
    tokenPlaceholder: 'phx_…',
    tokenDocs: 'https://app.posthog.com/settings/user-api-keys',
    envKey: 'POSTHOG_PERSONAL_API_KEY',
    hostEnvKey: 'POSTHOG_HOST',
    defaultHost: 'https://us.posthog.com',
    hostPlaceholder: 'https://us.posthog.com',
  },
  {
    id: 'sentry',
    label: 'Sentry',
    hint: 'Error tracking. Agents use `sentry-cli` (`SENTRY_AUTH_TOKEN`).',
    tokenPlaceholder: 'sntrys_… or auth token',
    tokenDocs: 'https://sentry.io/settings/account/api/auth-tokens/',
    envKey: 'SENTRY_AUTH_TOKEN',
    cli: 'sentry-cli',
    npmPackage: '@sentry/cli',
    hostEnvKey: 'SENTRY_URL',
    defaultHost: 'https://sentry.io',
    hostPlaceholder: 'https://sentry.io',
  },
];

export function optionalServiceSpec(id: OptionalServiceId): OptionalServiceSpec {
  const spec = OPTIONAL_SERVICES.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown optional service: ${id}`);
  return spec;
}

export function isOptionalServiceId(value: unknown): value is OptionalServiceId {
  return (
    typeof value === 'string' &&
    (OPTIONAL_SERVICE_IDS as readonly string[]).includes(value)
  );
}

/** Origin only (`https://host`). Falls back when empty or invalid. */
export function normalizeServiceOrigin(
  raw: string | null | undefined,
  fallback: string,
): string {
  const trimmed = raw?.trim() || fallback;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    return `${url.protocol}//${url.host}`;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return '';
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function authorizedGet(url: string, token: string): Promise<unknown> {
  const res = await httpFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const body = await readJson(res);
  if (!res.ok) {
    const record = asRecord(body);
    const message =
      firstString(record, ['message', 'error', 'error_description', 'detail']) ||
      (typeof body === 'string' ? body.trim().slice(0, 160) : '');
    throw new Error(
      message
        ? `${res.status}: ${message}`
        : `Request failed (${res.status})`,
    );
  }
  return body;
}

export async function verifyOptionalService(input: {
  id: OptionalServiceId;
  token: string;
  host?: string | null;
}): Promise<{ viewerName: string; host?: string }> {
  const token = input.token.trim();
  if (!token) throw new Error('A token is required');
  const spec = optionalServiceSpec(input.id);

  try {
    if (input.id === 'vercel') {
      const body = asRecord(await authorizedGet('https://api.vercel.com/v2/user', token));
      const user = asRecord(body?.user) ?? body;
      const name =
        firstString(user, ['username', 'name', 'email']) || 'Vercel user';
      return { viewerName: name };
    }

    if (input.id === 'supabase') {
      const body = await authorizedGet('https://api.supabase.com/v1/organizations', token);
      const list = Array.isArray(body) ? body : [];
      const first = asRecord(list[0]);
      const name = firstString(first, ['name', 'slug']) || 'Supabase';
      return { viewerName: list.length > 1 ? `${name} +${list.length - 1}` : name };
    }

    if (input.id === 'posthog') {
      const host = normalizeServiceOrigin(input.host, spec.defaultHost ?? 'https://us.posthog.com');
      const body = asRecord(await authorizedGet(`${host}/api/users/@me/`, token));
      const name =
        firstString(body, ['email', 'distinct_id']) ||
        [firstString(body, ['first_name']), firstString(body, ['last_name'])]
          .filter(Boolean)
          .join(' ') ||
        'PostHog user';
      return { viewerName: name, host };
    }

    const host = normalizeServiceOrigin(input.host, spec.defaultHost ?? 'https://sentry.io');
    const body = await authorizedGet(`${host}/api/0/organizations/`, token);
    const list = Array.isArray(body) ? body : [];
    const first = asRecord(list[0]);
    const name = firstString(first, ['slug', 'name']) || 'Sentry';
    return { viewerName: list.length > 1 ? `${name} +${list.length - 1}` : name, host };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${spec.label} rejected this token. ${detail} Create a token at ${spec.tokenDocs}`,
    );
  }
}

function applyConnection(
  integrations: IntegrationsSettings,
  id: OptionalServiceId,
  input: { token: string; host?: string; viewerName?: string },
): void {
  if (id === 'vercel') {
    integrations.vercelToken = input.token;
    if (input.viewerName) integrations.vercelViewerName = input.viewerName.slice(0, 120);
    return;
  }
  if (id === 'supabase') {
    integrations.supabaseAccessToken = input.token;
    if (input.viewerName) integrations.supabaseViewerName = input.viewerName.slice(0, 120);
    return;
  }
  if (id === 'posthog') {
    integrations.posthogPersonalApiKey = input.token;
    if (input.host) integrations.posthogHost = input.host;
    if (input.viewerName) integrations.posthogViewerName = input.viewerName.slice(0, 120);
    return;
  }
  integrations.sentryAuthToken = input.token;
  if (input.host) integrations.sentryHost = input.host;
  if (input.viewerName) integrations.sentryViewerName = input.viewerName.slice(0, 120);
}

function clearConnection(integrations: IntegrationsSettings, id: OptionalServiceId): void {
  if (id === 'vercel') {
    delete integrations.vercelToken;
    delete integrations.vercelViewerName;
    return;
  }
  if (id === 'supabase') {
    delete integrations.supabaseAccessToken;
    delete integrations.supabaseViewerName;
    return;
  }
  if (id === 'posthog') {
    delete integrations.posthogPersonalApiKey;
    delete integrations.posthogViewerName;
    return;
  }
  delete integrations.sentryAuthToken;
  delete integrations.sentryViewerName;
}

/** Verify a token and persist it (vaulted). */
export async function connectOptionalService(input: {
  id: OptionalServiceId;
  token: string;
  host?: string | null;
}): Promise<AppSettings> {
  if (!isOptionalServiceId(input.id)) {
    throw new Error('Unknown optional service');
  }
  const verified = await verifyOptionalService(input);
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  applyConnection(integrations, input.id, {
    token: input.token.trim(),
    host: verified.host,
    viewerName: verified.viewerName,
  });
  return saveAppSettings({ ...current, integrations });
}

/** Clear a stored optional-service token. Does not revoke remotely. */
export function disconnectOptionalService(id: OptionalServiceId): AppSettings {
  if (!isOptionalServiceId(id)) {
    throw new Error('Unknown optional service');
  }
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  clearConnection(integrations, id);
  return saveAppSettings({ ...current, integrations });
}

export function optionalServiceConnected(
  id: OptionalServiceId,
  integrations: IntegrationsSettings,
): boolean {
  if (id === 'vercel') return Boolean(integrations.vercelToken?.trim());
  if (id === 'supabase') return Boolean(integrations.supabaseAccessToken?.trim());
  if (id === 'posthog') return Boolean(integrations.posthogPersonalApiKey?.trim());
  return Boolean(integrations.sentryAuthToken?.trim());
}

export function connectedOptionalServices(
  integrations: IntegrationsSettings,
): OptionalServiceSpec[] {
  return OPTIONAL_SERVICES.filter((spec) => optionalServiceConnected(spec.id, integrations));
}

/**
 * Fresh-session playbook: official CLI (or HTTP API) with injected env.
 * Do not add vendor MCPs for these optional services.
 */
export function formatOptionalServicesDirective(
  integrations: IntegrationsSettings,
): string | null {
  const connected = connectedOptionalServices(integrations);
  if (connected.length === 0) return null;
  const lines = [
    'Optional connectors (connected — tokens are already in this process env):',
  ];
  for (const spec of connected) {
    if (spec.cli) {
      const extras = spec.hostEnvKey ? ` / \`${spec.hostEnvKey}\`` : '';
      lines.push(
        `- ${spec.label}: use the \`${spec.cli}\` CLI (\`${spec.envKey}\`${extras}). Do not add a ${spec.label} MCP.`,
      );
    } else {
      const extras = spec.hostEnvKey ? ` / \`${spec.hostEnvKey}\`` : '';
      lines.push(
        `- ${spec.label}: no first-class CLI — call the HTTP API with \`${spec.envKey}\`${extras}. Do not add a ${spec.label} MCP.`,
      );
    }
  }
  lines.push(
    'If a CLI is missing, say so or use the HTTP API with the same token. The user can Install CLI from Settings → Connectors. Do not ask the user to install a vendor MCP.',
  );
  return lines.join('\n');
}

/** Short resume reminder when at least one optional service is connected. */
export function formatOptionalServicesReminder(
  integrations: IntegrationsSettings,
): string | null {
  if (connectedOptionalServices(integrations).length === 0) return null;
  return 'Settings → Connectors: prefer official CLIs (`vercel`, `supabase`, `sentry-cli`) or the PostHog HTTP API with injected env. Do not add vendor MCPs.';
}
