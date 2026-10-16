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

export function phoneMcpToolPayload(
  parts: MessagePart[] | undefined,
  tool: string,
  callId: string,
): { input: Record<string, unknown>; resultText: string; isError: boolean } | null {
  if (!parts) return null;
  const matches = parts.filter(
    (part): part is Extract<MessagePart, { type: 'tool' }> =>
      part.type === 'tool' && part.name === tool && !part.parentId,
  );
  const part = matches.find((row) => row.id === callId) ?? matches[matches.length - 1];
  if (!part) return null;
  return {
    input: part.input ?? {},
    resultText: part.result ?? '',
    isError: part.status === 'error',
  };
}
