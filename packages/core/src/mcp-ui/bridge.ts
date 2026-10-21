/**
 * JSON-RPC between an MCP App iframe and the Sideboard host.
 * Pure so the renderer can run it without the MCP SDK.
 */

export type JsonRpcId = string | number;

export type BridgeEffect =
  | { type: 'reply'; message: Record<string, unknown> }
  | { type: 'resize'; width?: number; height?: number }
  | { type: 'open-link'; url: string; id: JsonRpcId }
  | { type: 'chat'; text: string; id: JsonRpcId }
  | { type: 'update-context'; text: string; id: JsonRpcId }
  | { type: 'call-tool'; name: string; args: Record<string, unknown>; id: JsonRpcId }
  | { type: 'read-resource'; uri: string; id: JsonRpcId }
  | { type: 'ready' }
  | { type: 'legacy-call-tool'; name: string; args: Record<string, unknown>; messageId?: string }
  | { type: 'legacy-chat'; text: string; messageId?: string }
  | { type: 'legacy-link'; url: string; messageId?: string };

export type BridgeHostContext = Record<string, unknown>;

const PROTOCOL_VERSION = '2026-01-26';

export function toolInputNotification(args: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-input',
    params: { arguments: args ?? {} },
  };
}

export function toolResultNotification(result: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-result',
    params: result,
  };
}

export function guestBridgeEffects(
  message: unknown,
  hostContext: BridgeHostContext,
): BridgeEffect[] {
  const legacy = legacyEffects(message);
  if (legacy) return legacy;
  const rec = asRecord(message);
  if (rec.jsonrpc !== '2.0') return [];
  const method = typeof rec.method === 'string' ? rec.method : '';
  if (!method) return [];
  const params = asRecord(rec.params);
  const id = rpcId(rec.id);

  if (method === 'ui/initialize' && id !== undefined) {
    return [{ type: 'reply', message: initializeResult(id, hostContext) }];
  }
  if (method === 'ui/notifications/initialized') return [{ type: 'ready' }];
  if (method === 'ping' && id !== undefined) {
    return [{ type: 'reply', message: rpcResult(id, {}) }];
  }
  if (method === 'ui/notifications/size-changed') {
    const width = finite(params.width);
    const height = finite(params.height);
    if (width == null && height == null) return [];
    return [{ type: 'resize', ...(width != null ? { width } : {}), ...(height != null ? { height } : {}) }];
  }
  if (method === 'ui/open-link' && id !== undefined) {
    const url = typeof params.url === 'string' ? params.url.trim() : '';
    if (!isHttpUrl(url)) {
      return [{ type: 'reply', message: rpcError(id, 'Invalid URL') }];
    }
    return [{ type: 'open-link', url, id }];
  }
  if (method === 'ui/message' && id !== undefined) {
    const text = messageText(params);
    if (!text) return [{ type: 'reply', message: rpcError(id, 'Invalid message format') }];
    return [{ type: 'chat', text, id }];
  }
  if (method === 'ui/update-model-context' && id !== undefined) {
    const text = modelContextText(params);
    if (!text) return [{ type: 'reply', message: rpcError(id, 'Invalid content format') }];
    return [{ type: 'update-context', text, id }];
  }
  if (method === 'ui/request-display-mode' && id !== undefined) {
    return [{ type: 'reply', message: rpcResult(id, { mode: 'inline' }) }];
  }
  if (method === 'tools/call' && id !== undefined) {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!name) return [{ type: 'reply', message: rpcError(id, 'Missing tool name') }];
    return [{ type: 'call-tool', name, args: asRecord(params.arguments), id }];
  }
  if (method === 'resources/read' && id !== undefined) {
    const uri = typeof params.uri === 'string' ? params.uri.trim() : '';
    if (!uri) return [{ type: 'reply', message: rpcError(id, 'Missing resource URI') }];
    return [{ type: 'read-resource', uri, id }];
  }
  if (id !== undefined && method.startsWith('ui/')) {
    return [{ type: 'reply', message: rpcError(id, `Unsupported method ${method}`) }];
  }
  return [];
}

export function resourceTeardownRequest(id: JsonRpcId, reason: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method: 'ui/resource-teardown', params: { reason } };
}

export function rpcResult(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id: JsonRpcId, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code: -32000, message } };
}

export function legacyAck(messageId: string): Record<string, unknown> {
  return { type: 'ui-message-received', messageId };
}

export function legacyResponse(messageId: string, response: unknown, error?: unknown): Record<string, unknown> {
  return {
    type: 'ui-message-response',
    messageId,
    payload: error ? { error } : { response },
  };
}

function initializeResult(id: JsonRpcId, hostContext: BridgeHostContext): Record<string, unknown> {
  return rpcResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    hostInfo: { name: 'sideboard', version: '1.0.0' },
    hostCapabilities: {
      openLinks: {},
      serverTools: {},
      serverResources: {},
    },
    hostContext,
  });
}

function legacyEffects(message: unknown): BridgeEffect[] | null {
  const rec = asRecord(message);
  const type = typeof rec.type === 'string' ? rec.type : '';
  if (type !== 'tool' && type !== 'prompt' && type !== 'link' && type !== 'intent' && type !== 'notify') {
    return null;
  }
  const messageId = typeof rec.messageId === 'string' ? rec.messageId : undefined;
  const payload = asRecord(rec.payload);
  if (type === 'tool') {
    const name = typeof payload.toolName === 'string' ? payload.toolName.trim() : '';
    if (!name) return [];
    const args = asRecord(payload.params ?? payload.arguments);
    return [{ type: 'legacy-call-tool', name, args, ...(messageId ? { messageId } : {}) }];
  }
  if (type === 'prompt' || type === 'intent') {
    const text =
      (typeof payload.prompt === 'string' && payload.prompt.trim()) ||
      (typeof payload.text === 'string' && payload.text.trim()) ||
      '';
    if (!text) return [];
    return [{ type: 'legacy-chat', text: text.slice(0, 8_000), ...(messageId ? { messageId } : {}) }];
  }
  if (type === 'link') {
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!isHttpUrl(url)) return [];
    return [{ type: 'legacy-link', url, ...(messageId ? { messageId } : {}) }];
  }
  return [];
}

function modelContextText(params: Record<string, unknown>): string | null {
  const lines: string[] = [];
  const content = Array.isArray(params.content) ? params.content : [];
  for (const block of content) {
    const rec = asRecord(block);
    if (typeof rec.text === 'string' && rec.text.trim()) lines.push(rec.text.trim());
  }
  const structured = params.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    lines.push(JSON.stringify(structured));
  }
  const body = lines.join('\n').trim().slice(0, 8_000);
  return body ? `MCP App context:\n${body}` : null;
}

function messageText(params: Record<string, unknown>): string {
  const content = asRecord(params.content);
  const nested = typeof content.text === 'string' ? content.text.trim() : '';
  const direct = typeof params.text === 'string' ? params.text.trim() : '';
  return (nested || direct).slice(0, 8_000);
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function rpcId(value: unknown): JsonRpcId | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
