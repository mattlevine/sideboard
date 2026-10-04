/** JSON-RPC 2.0 over the Sideboard agent WebSocket. */

export const AGENT_RPC_PROTOCOL_VERSION = 1;
export const AGENT_RPC_PATH = '/agent-rpc';
export const AGENT_RPC_KEEPALIVE_MS = 10_000;
/**
 * Max time one `job.wait` call stays open before returning `stillRunning`.
 * Must stay well under the Cursor runner's stream idle guard
 * (`CURSOR_STREAM_IDLE_MS`, 180s): a blocked custom tool emits no stream
 * frames, and the runner ends the turn when the stream looks idle.
 */
export const AGENT_RPC_JOB_HOLD_MAX_MS = 120_000;
export const AGENT_RPC_JOB_SLICE_MS = 10_000;

export const AGENT_RPC_NATIVE_ENV = 'SIDEBOARD_AGENT_RPC_NATIVE';

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
  authToken: string;
};

export type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcError = {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcError | JsonRpcNotification;

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_UNAUTHORIZED = -32001;
export const RPC_INTERNAL_ERROR = -32603;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  if (rec.jsonrpc !== '2.0') return false;
  if (typeof rec.method !== 'string' || !rec.method.trim()) return false;
  if (rec.id === undefined || rec.id === null) return false;
  if (typeof rec.id !== 'string' && typeof rec.id !== 'number') return false;
  return true;
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  if (rec.jsonrpc !== '2.0') return false;
  if (typeof rec.method !== 'string' || !rec.method.trim()) return false;
  if ('id' in rec && rec.id !== undefined) return false;
  if ('error' in rec || 'result' in rec) return false;
  return true;
}

export function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function rpcNotify(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined
    ? { jsonrpc: '2.0', method }
    : { jsonrpc: '2.0', method, params };
}

export function parseRpcFrame(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
