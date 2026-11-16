import { httpFetch } from '../http/fetch.js';
import { readClaudeAccessToken } from './claude-usage-client.js';

/**
 * Config key Claude turns into `mcp__claude_ai_PostHog__*`.
 * `--strict-mcp-config` skips the account connector fetch, so this server has
 * to be passed in `--mcp-config`. Dynamic scope is the one scope that keeps
 * `type: "claudeai-proxy"`.
 */
export const CLAUDE_POSTHOG_CONNECTOR_SERVER = 'claude.ai PostHog';

const LIST_URL = 'https://api.anthropic.com/v1/mcp_servers?limit=1000&include_additional_installs=true';
const PROXY_ORIGIN = 'https://mcp-proxy.anthropic.com';
const ID_RE = /^[A-Za-z0-9_-]+$/;
const SUCCESS_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 30_000;

export type ClaudeAiProxyConfig = {
  type: 'claudeai-proxy';
  id: string;
  url: string;
  displayName: string;
  alwaysLoad: true;
};

let cache: { at: number; value: ClaudeAiProxyConfig | null } | null = null;
let turnOverride: (() => Promise<ClaudeAiProxyConfig | null>) | undefined;

export function setClaudePosthogConnectorForTests(
  fn: (() => Promise<ClaudeAiProxyConfig | null>) | undefined,
): void {
  turnOverride = fn;
  cache = null;
}

export function resetClaudePosthogConnectorCacheForTests(): void {
  cache = null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function rowsFrom(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter((row): row is Record<string, unknown> => asRecord(row) !== null);
  }
  const record = asRecord(body);
  const data = record?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => asRecord(row) !== null);
}

function isPosthogName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const head = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0];
  return head === 'posthog';
}

function rowId(row: Record<string, unknown>): string | null {
  const id = row.id;
  return typeof id === 'string' && ID_RE.test(id) ? id : null;
}

/** Pick the signed-in PostHog connector from `GET /v1/mcp_servers`. */
export function posthogConnectorFromList(body: unknown): ClaudeAiProxyConfig | null {
  const matches = rowsFrom(body).filter(
    (row) =>
      row.eligible !== false &&
      rowId(row) !== null &&
      (isPosthogName(row.display_name) ||
        isPosthogName(row.displayName) ||
        isPosthogName(row.name)),
  );
  const row =
    matches.find((item) => item.additional_install !== true && item.additionalInstall !== true) ??
    matches[0];
  const id = row ? rowId(row) : null;
  if (!id) return null;
  return {
    type: 'claudeai-proxy',
    id,
    url: `${PROXY_ORIGIN}/v1/mcp/${id}`,
    displayName: 'PostHog',
    alwaysLoad: true,
  };
}

async function loadClaudePosthogConnector(now = Date.now()): Promise<ClaudeAiProxyConfig | null> {
  if (cache && now - cache.at < (cache.value ? SUCCESS_TTL_MS : MISS_TTL_MS)) return cache.value;
  const token = await readClaudeAccessToken();
  if (!token) {
    cache = { at: now, value: null };
    return null;
  }
  try {
    const res = await httpFetch(LIST_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-servers-2025-12-04',
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) {
      cache = { at: now, value: null };
      return null;
    }
    const value = posthogConnectorFromList(await res.json());
    cache = { at: now, value };
    return value;
  } catch {
    cache = { at: now, value: null };
    return null;
  }
}

/**
 * Connector entry for this Claude turn. Unit tests skip the account fetch
 * unless they install an override — a real lookup reads the Claude login.
 */
export async function claudePosthogConnectorForTurn(): Promise<ClaudeAiProxyConfig | null> {
  if (turnOverride) return turnOverride();
  if (process.env.VITEST) return null;
  return loadClaudePosthogConnector();
}
