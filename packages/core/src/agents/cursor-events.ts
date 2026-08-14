import type { AgentEvent, TokenUsage } from '../types/thread.js';
import { extractJsonErrorMessage, formatUnknownDetail } from './error-detail.js';

/** JSON payload written to the Cursor runner on stdin. */
export type CursorTurnRequest = {
  prompt: string;
  cwd: string;
  agentId?: string | null;
  model?: string | null;
  /** Reasoning effort (independent of {@link CursorTurnRequest.fast}). */
  effort?: string | null;
  fast?: boolean;
  planMode?: boolean;
  apiKey?: string;
  /**
   * Inline MCP servers for this turn (Sideboard / Brightsy).
   * Must be passed on create and resume — Cursor does not persist them.
   */
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
};

/** Subset of Cursor SDK stream messages we care about (keeps tests free of the SDK). */
export type CursorSdkStreamMessage = {
  type: string;
  agent_id?: string;
  text?: string;
  call_id?: string;
  name?: string;
  status?: string;
  args?: unknown;
  result?: unknown;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

function usageFromCursor(usage: CursorSdkStreamMessage['usage']): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = Number(usage.inputTokens ?? 0);
  const outputTokens = Number(usage.outputTokens ?? 0);
  if (!inputTokens && !outputTokens) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.cacheReadTokens ? Number(usage.cacheReadTokens) : undefined,
    cacheWriteTokens: usage.cacheWriteTokens ? Number(usage.cacheWriteTokens) : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Cursor MCP tools stream as `name: "mcp"` with nested
 * `{ providerIdentifier, toolName, args }` — flatten to Claude-style
 * `mcp__<provider>__<tool>` + flat input so present_* extractors work.
 */
export function normalizeCursorToolCall(
  name: string,
  args: unknown,
): { name: string; input?: Record<string, unknown> } {
  const raw = asRecord(args);
  const toolName =
    typeof raw?.toolName === 'string' && raw.toolName.trim() ? raw.toolName.trim() : null;
  const looksLikeMcp =
    name === 'mcp' ||
    (toolName != null &&
      (typeof raw?.providerIdentifier === 'string' || asRecord(raw?.args) != null));

  if (looksLikeMcp && toolName) {
    const providerRaw =
      typeof raw!.providerIdentifier === 'string' && raw!.providerIdentifier.trim()
        ? raw!.providerIdentifier.trim()
        : 'sideboard';
    const provider = providerRaw.replace(/[^a-zA-Z0-9_-]/g, '_');
    const nested = asRecord(raw!.args);
    return {
      name: `mcp__${provider}__${toolName}`,
      input: nested ?? { toolName },
    };
  }

  return { name, input: raw };
}

/** Unwrap Cursor MCP result envelopes to the tool's text payload. */
export function unwrapCursorToolResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === 'string') return result;

  const rec = asRecord(result);
  if (!rec) {
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  const collectTexts = (items: unknown[]): string[] => {
    const texts: string[] = [];
    for (const item of items) {
      const row = asRecord(item);
      if (!row) continue;
      if (typeof row.text === 'string') {
        texts.push(row.text);
        continue;
      }
      const nested = asRecord(row.text);
      if (typeof nested?.text === 'string') texts.push(nested.text);
    }
    return texts;
  };

  // Cursor MCP: { status, value: { content: [{ text: { text } }], isError } }
  const value = asRecord(rec.value);
  if (value && Array.isArray(value.content)) {
    const texts = collectTexts(value.content);
    if (texts.length) return texts.join('\n');
  }

  // Standard MCP content array on the result itself.
  if (Array.isArray(rec.content)) {
    const texts = collectTexts(rec.content);
    if (texts.length) return texts.join('\n');
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function cursorToolResultIsError(status: string | undefined, result: unknown): boolean {
  if (status === 'error') return true;
  const rec = asRecord(result);
  if (!rec) return false;
  if (rec.status === 'error') return true;
  const value = asRecord(rec.value);
  return value?.isError === true;
}

/**
 * Map a Cursor SDK stream message into Sideboard AgentEvent(s).
 * Mirrors how Conductor consumes `run.stream()` events.
 */
export function cursorSdkMessageToEvents(msg: CursorSdkStreamMessage): AgentEvent[] {
  if (!msg?.type) return [];

  if (msg.type === 'system' && msg.agent_id) {
    return [{ type: 'session_id', data: msg.agent_id }];
  }

  if (msg.type === 'thinking' && msg.text) {
    return [{ type: 'thinking', data: msg.text }];
  }

  if (msg.type === 'assistant' && msg.message?.content?.length) {
    const out: AgentEvent[] = [];
    for (const block of msg.message.content) {
      if (block?.type === 'text' && block.text) {
        out.push({ type: 'stdout', data: block.text });
      } else if (block?.type === 'tool_use' && block.id && block.name) {
        const normalized = normalizeCursorToolCall(block.name, block.input);
        out.push({
          type: 'tool_use',
          id: block.id,
          name: normalized.name,
          input: normalized.input,
        });
      }
    }
    return out;
  }

  if (msg.type === 'tool_call' && msg.call_id && msg.name) {
    const normalized = normalizeCursorToolCall(msg.name, msg.args);
    if (msg.status === 'running') {
      return [
        {
          type: 'tool_use',
          id: msg.call_id,
          name: normalized.name,
          input: normalized.input,
        },
      ];
    }
    if (msg.status === 'completed' || msg.status === 'error') {
      // Always upsert tool_use on completion — Cursor sometimes skips `running`,
      // and applyAgentEvent previously dropped orphan tool_result events.
      return [
        {
          type: 'tool_use',
          id: msg.call_id,
          name: normalized.name,
          input: normalized.input,
        },
        {
          type: 'tool_result',
          id: msg.call_id,
          content: unwrapCursorToolResult(msg.result),
          isError: cursorToolResultIsError(msg.status, msg.result),
        },
      ];
    }
  }

  if (msg.type === 'usage') {
    const usage = usageFromCursor(msg.usage);
    if (usage) return [{ type: 'usage', data: usage, scope: 'request' }];
  }

  if (msg.type === 'status' && msg.status === 'ERROR') {
    const rawMessage = (msg as { message?: unknown }).message;
    const detail =
      (typeof rawMessage === 'string' ? rawMessage.trim() : '') ||
      extractJsonErrorMessage(msg as unknown as Record<string, unknown>) ||
      formatUnknownDetail((msg as { error?: unknown }).error) ||
      msg.text ||
      'Cursor run entered ERROR status';
    return [{ type: 'stderr', data: detail }];
  }

  if (msg.type === 'error') {
    const detail =
      extractJsonErrorMessage(msg as unknown as Record<string, unknown>) ||
      formatUnknownDetail((msg as { error?: unknown }).error) ||
      msg.text ||
      'Cursor run error';
    return [{ type: 'stderr', data: detail }];
  }

  return [];
}

/** Parse one NDJSON line emitted by the Cursor runner (already Sideboard AgentEvents). */
export function parseCursorRunnerLine(line: string): AgentEvent | AgentEvent[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as AgentEvent | AgentEvent[] | { events?: AgentEvent[] };
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object' && 'events' in obj && Array.isArray(obj.events)) {
      return obj.events;
    }
    if (obj && typeof obj === 'object' && 'type' in obj) {
      return obj as AgentEvent;
    }
    return null;
  } catch {
    return { type: 'stdout', data: line };
  }
}
