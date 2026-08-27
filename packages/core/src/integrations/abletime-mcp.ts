import { httpFetch } from '../http/fetch.js';
import {
  getAbleTimeAccessToken,
  getAbleTimeHost,
  isAbleTimeConnected,
} from '../store/app-settings.js';

export const DEFAULT_ABLETIME_HOST = 'https://track.abletime.com';
export const ABLETIME_MCP_PATH = '/api/public/v2/mcp';

const MCP_PROTOCOL_VERSION = '2025-03-26';

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
  | 'full_catalog';

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

export function abletimeMcpUrl(host?: string | null): string {
  return `${normalizeAbleTimeHost(host)}${ABLETIME_MCP_PATH}`;
}

export function rewriteAbleTimeError(message: string): string {
  if (/INTEGRATION_AGENT_ACCESS_DISABLED|agent access/i.test(message)) {
    return `${message} — Enable Agent access (MCP) in AbleTime Settings → Integrations → API Keys.`;
  }
  if (/INTEGRATION_PAT_REQUIRED|organization api key/i.test(message)) {
    return `${message} — AbleTime MCP needs a personal access token (apt_…), not an organization API key.`;
  }
  if (/INTEGRATION_PLAN_REQUIRED/i.test(message)) {
    return `${message} — AbleTime plan does not include API access.`;
  }
  if (/INTEGRATION_KEY_INVALID|INTEGRATION_KEY_MISSING|401|unauthorized|invalid token/i.test(message)) {
    return `${message} — Reconnect AbleTime from Account settings (Profile → API Access).`;
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
  opts?: { token?: string | null; host?: string | null },
): Promise<unknown> {
  const token = (opts?.token ?? getAbleTimeAccessToken())?.trim();
  if (!token) {
    throw new Error('AbleTime is not connected — paste a personal access token in Account settings');
  }
  const url = abletimeMcpUrl(
    opts?.host ?? (opts?.token ? DEFAULT_ABLETIME_HOST : getAbleTimeHost()),
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
  opts?: { token?: string | null; host?: string | null },
): Promise<T> {
  if (!opts?.token && !isAbleTimeConnected()) {
    throw new Error('AbleTime is not connected — paste a personal access token in Account settings');
  }

  const call = () =>
    abletimeMcpRequest('tools/call', { name, arguments: args }, opts).then((result) => {
      return unwrapToolResult(result) as T;
    });

  try {
    return await call();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/initialize|session|not initialized|-32000/i.test(message)) {
      await initializeIfNeeded(opts);
      return await call();
    }
    throw err instanceof Error ? new Error(rewriteAbleTimeError(err.message)) : err;
  }
}
