import { httpFetch } from '../http/fetch.js';
import { getAbleTimeHost, isAbleTimeConnected } from '../store/app-settings.js';

export const DEFAULT_ABLETIME_HOST = 'https://track.abletime.com';
export const ABLETIME_MCP_PATH = '/api/public/v2/mcp';
export const ABLETIME_MCP_PM_PATH = '/api/public/v2/mcp/pm';

const MCP_PROTOCOL_VERSION = '2025-03-26';

/** Project-management tools live on `/mcp/pm`, not the time-tracking endpoint. */
export const ABLETIME_PM_TOOL_NAMES = [
  'set_task_assignee',
  'set_task_priority',
  'set_task_stage',
  'set_task_dependency',
  'set_task_blocked',
  'set_task_locked',
  'set_task_schedule',
  'clear_task_schedule',
  'archive_task',
  'delete_task',
] as const;

export type AbleTimePmToolName = (typeof ABLETIME_PM_TOOL_NAMES)[number];

export type AbleTimeMcpToolName =
  | 'orientation'
  | 'upsert_entry'
  | 'update_entry'
  | 'list_entries'
  | 'delete_entry'
  | 'accept_entry'
  | 'get_project'
  | 'create_task'
  | 'update_task'
  | 'get_task'
  | 'list_tasks'
  | 'set_task_state'
  | 'create_comment'
  | 'description_schema'
  | 'search_tasks'
  | 'list_projects'
  | 'list_users'
  | 'tool_schema'
  | 'full_catalog'
  | AbleTimePmToolName;

export function abletimeToolUsesPm(name: string): boolean {
  return (ABLETIME_PM_TOOL_NAMES as readonly string[]).includes(name);
}

type JsonRpcError = { code?: number; message?: string; data?: unknown };

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: JsonRpcError;
};

export function normalizeAbleTimeHost(raw?: string | null): string {
  const trimmed = raw?.trim() || DEFAULT_ABLETIME_HOST;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export function abletimeMcpUrl(
  host?: string | null,
  opts?: { pm?: boolean },
): string {
  const path = opts?.pm ? ABLETIME_MCP_PM_PATH : ABLETIME_MCP_PATH;
  return `${normalizeAbleTimeHost(host)}${path}`;
}

/** Official prefixes: PAT `apt_…` (MCP), org key `atk_…` (REST only). */
export const ABLETIME_PAT_PREFIX = 'apt_';
export const ABLETIME_ORG_KEY_PREFIX = 'atk_';

const ORG_KEY_HINT =
  'AbleTime MCP needs a personal access token (apt_…) from Edit Profile → API Access, not an organization API key (atk_…) from Settings → Integrations → API Keys.';

const REJECTED_CREDENTIAL_HINT =
  'AbleTime rejected this credential (unknown, revoked, or expired). Use a personal access token (apt_…) from Edit Profile → API Access — organization API keys (atk_…) cannot call MCP. Tokens are shown once; rotating replaces the previous one.';

const REWRITE_APPLIED =
  /— Enable Agent access \(MCP\)|— AbleTime MCP needs a personal access token|— AbleTime plan does not include API access|— AbleTime rejected this credential/;

/** Strip a pasted `Bearer ` prefix and surrounding whitespace. */
export function normalizeAbleTimeCredential(raw: string): string {
  return raw.trim().replace(/^bearer\s+/i, '').trim();
}

export function ableTimeCredentialKind(
  raw: string,
): 'pat' | 'org' | 'unknown' {
  const token = normalizeAbleTimeCredential(raw).toLowerCase();
  if (token.startsWith(ABLETIME_PAT_PREFIX)) return 'pat';
  if (token.startsWith(ABLETIME_ORG_KEY_PREFIX)) return 'org';
  return 'unknown';
}

/** MCP accepts personal access tokens only. Organization keys use REST. */
export function assertAbleTimeMcpCredential(raw: string): string {
  const token = normalizeAbleTimeCredential(raw);
  if (!token) {
    throw new Error('AbleTime personal access token is required');
  }
  if (ableTimeCredentialKind(token) === 'org') {
    throw new Error(ORG_KEY_HINT);
  }
  return token;
}

export function assertAbleTimeCredential(raw: string): string {
  const token = normalizeAbleTimeCredential(raw);
  if (!token) {
    throw new Error('AbleTime API key or personal access token is required');
  }
  return token;
}

export function rewriteAbleTimeError(message: string): string {
  if (REWRITE_APPLIED.test(message)) return message;
  if (/INTEGRATION_AGENT_ACCESS_DISABLED/i.test(message)) {
    return `${message} — Enable Agent access (MCP) in AbleTime Settings → Integrations → API Keys.`;
  }
  if (/INTEGRATION_PAT_REQUIRED/i.test(message)) {
    return `${message} — ${ORG_KEY_HINT}`;
  }
  if (/INTEGRATION_PLAN_REQUIRED/i.test(message)) {
    return `${message} — AbleTime plan does not include API access.`;
  }
  if (/INTEGRATION_KEY_INVALID|INTEGRATION_KEY_MISSING|401|unauthorized|invalid token/i.test(message)) {
    return `${message} — ${REJECTED_CREDENTIAL_HINT}`;
  }
  return message;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSseJson(body: string): unknown {
  const blocks = body.split(/\n\n+/);
  let last: unknown;
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]')
      .join('\n');
    if (!data) continue;
    try {
      last = JSON.parse(data);
    } catch {
      // ignore non-JSON event payloads
    }
  }
  if (last !== undefined) return last;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`AbleTime MCP returned a non-JSON response: ${body.slice(0, 200)}`);
  }
}

function unwrapToolResult(result: unknown): unknown {
  const record = asRecord(result);
  if (!record) return result;
  const content = record.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        const item = asRecord(part);
        if (!item) return '';
        return typeof item.text === 'string' ? item.text : '';
      })
      .filter(Boolean);
    if (texts.length === 1) {
      const text = texts[0]!;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    if (texts.length > 1) return texts.join('\n');
  }
  if (record.structuredContent != null) return record.structuredContent;
  if (record.isError === true) {
    const message =
      typeof record.message === 'string'
        ? record.message
        : textsFromUnknown(result) || 'AbleTime tool failed';
    throw new Error(message);
  }
  return result;
}

function textsFromUnknown(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '';
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return '';
}

export async function abletimeMcpRequest(
  method: string,
  params?: unknown,
  opts?: { token?: string | null; host?: string | null; pm?: boolean },
): Promise<unknown> {
  const rawToken =
    opts?.token ?? (await import('./abletime-oauth.js').then((m) => m.ensureAbleTimeAccessToken()));
  if (!rawToken?.trim()) {
    throw new Error('AbleTime is not connected — paste a personal access token in Account settings');
  }
  const token = assertAbleTimeMcpCredential(rawToken);
  const url = abletimeMcpUrl(
    opts?.host ?? (opts?.token ? DEFAULT_ABLETIME_HOST : getAbleTimeHost()),
    { pm: opts?.pm },
  );
  const res = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });

  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(
      rewriteAbleTimeError(
        `AbleTime MCP error ${res.status}${body ? `: ${body.slice(0, 240)}` : ''}`,
      ),
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  const parsed = contentType.includes('text/event-stream')
    ? parseSseJson(body)
    : (() => {
        try {
          return JSON.parse(body) as unknown;
        } catch {
          return parseSseJson(body);
        }
      })();

  const rpc = asRecord(parsed) as JsonRpcResponse | null;
  if (rpc?.error) {
    const detail =
      typeof rpc.error.message === 'string' && rpc.error.message.trim()
        ? rpc.error.message
        : `AbleTime MCP error ${rpc.error.code ?? ''}`.trim();
    throw new Error(rewriteAbleTimeError(detail));
  }
  if (rpc && 'result' in rpc) return rpc.result;
  return parsed;
}

async function initializeIfNeeded(opts?: {
  token?: string | null;
  host?: string | null;
  pm?: boolean;
}): Promise<void> {
  try {
    await abletimeMcpRequest(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'sideboard', version: '1.0.0' },
      },
      opts,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already initialized|not (required|supported)|method not found|-32601/i.test(message)) {
      return;
    }
    throw err;
  }
}

export async function callAbleTimeTool<T = unknown>(
  name: AbleTimeMcpToolName,
  args: Record<string, unknown> = {},
  opts?: { token?: string | null; host?: string | null; pm?: boolean },
): Promise<T> {
  if (!opts?.token && !isAbleTimeConnected()) {
    throw new Error('AbleTime is not connected — paste a personal access token in Account settings');
  }

  const rawToken =
    opts?.token ?? (await import('./abletime-oauth.js').then((m) => m.ensureAbleTimeAccessToken()));
  if (rawToken && ableTimeCredentialKind(rawToken) === 'org') {
    const { callAbleTimeRestTool } = await import('./abletime-rest.js');
    return callAbleTimeRestTool<T>(name, args, { ...opts, token: rawToken });
  }

  const requestOpts = { ...opts, pm: opts?.pm ?? abletimeToolUsesPm(name) };
  const call = () =>
    abletimeMcpRequest('tools/call', { name, arguments: args }, requestOpts).then((result) => {
      return unwrapToolResult(result) as T;
    });

  try {
    return await call();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/initialize|session|not initialized|-32000/i.test(message)) {
      await initializeIfNeeded(requestOpts);
      return await call();
    }
    throw err instanceof Error ? new Error(rewriteAbleTimeError(err.message)) : err;
  }
}
