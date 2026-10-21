import type { MessagePart } from '../types/thread.js';

/** A finished Claude MCP tool the phone can ask the Mac to render. */
export type PhoneMcpAppRef = { id: string; tool: string };

const MAX_APPS = 4;

export function phoneMcpApps(
  agent: string | undefined,
  parts: MessagePart[] | undefined,
): PhoneMcpAppRef[] {
  if (agent !== 'claude' || !parts?.length) return [];
  const out: PhoneMcpAppRef[] = [];
  for (const part of parts) {
    if (part.type !== 'tool' || part.parentId || part.status === 'running') continue;
    if (!part.name.startsWith('mcp__') || part.name.startsWith('mcp__sideboard')) continue;
    out.push({ id: part.id, tool: part.name });
    if (out.length >= MAX_APPS) break;
  }
  return out;
}

/** Optional `apps` on a phone transcript row. */
export type PhoneMcpAppsField = { apps?: PhoneMcpAppRef[] };

export type PhoneMcpUiRequest =
  | { op: 'mcp-ui'; chatId: string; tool: string; callId: string; reqId: string }
  | {
      op: 'mcp-ui-call';
      chatId: string;
      reqId: string;
      server: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | { op: 'mcp-ui-read'; chatId: string; reqId: string; server: string; uri: string }
  | { op: 'mcp-ui-context'; chatId: string; reqId: string; text: string };

export interface PhoneMcpUiView {
  server: string;
  tool: string;
  html: string;
  csp: string;
  uri: string;
  input: Record<string, unknown>;
  resultText: string;
  isError: boolean;
}

export type PhoneMcpUiReply =
  | { op: 'mcp-ui'; chatId: string; reqId: string; view: PhoneMcpUiView | null }
  | { op: 'mcp-ui-call'; chatId: string; reqId: string; result?: unknown; error?: string }
  | { op: 'mcp-ui-read'; chatId: string; reqId: string; result?: unknown; error?: string }
  | { op: 'mcp-ui-context'; chatId: string; reqId: string; result?: unknown; error?: string };

function controlText(value: object, key: string): string {
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Parse a phone MCP App command. `invalid` when the op matches but the body does not. */
export function parsePhoneMcpUi(value: object, op: string, chatId: string): PhoneMcpUiRequest | 'invalid' {
  if (op === 'mcp-ui') {
    const tool = controlText(value, 'tool');
    const callId = controlText(value, 'callId');
    const reqId = controlText(value, 'reqId');
    if (!tool.startsWith('mcp__') || tool.length > 200 || !callId || !reqId || reqId.length > 40) {
      return 'invalid';
    }
    return { op: 'mcp-ui', chatId, tool, callId, reqId };
  }
  if (op === 'mcp-ui-context') {
    const reqId = controlText(value, 'reqId');
    const text = controlText(value, 'text');
    if (!reqId || reqId.length > 40 || !text || text.length > 8_000) return 'invalid';
    return { op, chatId, reqId, text };
  }
  if (op !== 'mcp-ui-call' && op !== 'mcp-ui-read') return 'invalid';
  const reqId = controlText(value, 'reqId');
  const server = controlText(value, 'server');
  if (!reqId || reqId.length > 40 || !server || server.length > 120) return 'invalid';
  if (op === 'mcp-ui-read') {
    const uri = controlText(value, 'uri');
    if (!uri || uri.length > 500 || /\s/.test(uri) || /^(javascript|data):/i.test(uri)) {
      return 'invalid';
    }
    return { op, chatId, reqId, server, uri };
  }
  const tool = controlText(value, 'tool');
  const args = (value as { args?: unknown }).args;
  if (!tool || tool.length > 200 || !args || typeof args !== 'object' || Array.isArray(args)) {
    return 'invalid';
  }
  return { op, chatId, reqId, server, tool, args: args as Record<string, unknown> };
}

export function phoneMcpToolPayload(
  parts: MessagePart[] | undefined,
  tool: string,
  callId: string,
): { input: Record<string, unknown>; resultText: string; isError: boolean } | null {
  if (!parts) return null;
  const part = parts.find(
    (row): row is Extract<MessagePart, { type: 'tool' }> =>
      row.type === 'tool' && row.id === callId && row.name === tool && !row.parentId,
  );
  if (!part) return null;
  return {
    input: part.input ?? {},
    resultText: part.result ?? '',
    isError: part.status === 'error',
  };
}

/** The app's call id can sit on an earlier agent message than the latest turn. */
export function phoneMcpToolPayloadFromMessages(
  messages: Array<{ role: string; parts?: MessagePart[] }>,
  tool: string,
  callId: string,
): { input: Record<string, unknown>; resultText: string; isError: boolean } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'agent') continue;
    const payload = phoneMcpToolPayload(message.parts, tool, callId);
    if (payload) return payload;
  }
  return null;
}
