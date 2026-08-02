import type { AgentEvent, TokenUsage } from '../types/thread.js';

/** JSON payload written to the Cursor runner on stdin. */
export type CursorTurnRequest = {
  prompt: string;
  cwd: string;
  agentId?: string | null;
  model?: string | null;
  fast?: boolean;
  planMode?: boolean;
  apiKey?: string;
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
        out.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input:
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : undefined,
        });
      }
    }
    return out;
  }

  if (msg.type === 'tool_call' && msg.call_id && msg.name) {
    if (msg.status === 'running') {
      return [
        {
          type: 'tool_use',
          id: msg.call_id,
          name: msg.name,
          input:
            msg.args && typeof msg.args === 'object'
              ? (msg.args as Record<string, unknown>)
              : undefined,
        },
      ];
    }
    if (msg.status === 'completed' || msg.status === 'error') {
      const content =
        typeof msg.result === 'string'
          ? msg.result
          : msg.result != null
            ? JSON.stringify(msg.result)
            : undefined;
      return [
        {
          type: 'tool_result',
          id: msg.call_id,
          content,
          isError: msg.status === 'error',
        },
      ];
    }
  }

  if (msg.type === 'usage') {
    const usage = usageFromCursor(msg.usage);
    if (usage) return [{ type: 'usage', data: usage }];
  }

  if (msg.type === 'status' && msg.status === 'ERROR') {
    const detail =
      (msg as { message?: string }).message ||
      msg.text ||
      'Cursor run entered ERROR status';
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
