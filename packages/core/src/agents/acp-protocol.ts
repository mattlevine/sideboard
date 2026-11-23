/**
 * Agent Client Protocol (JSON-RPC over stdio) helpers shared by the runner
 * and tests. No process spawn here.
 *
 * Session resume: a harness is resumed only when `initialize` reports
 * `loadSession`. Otherwise each turn is a new session and Sideboard replays
 * the prior transcript into the prompt. The harness process does not stay
 * alive between turns.
 */
import type { AgentEvent, TokenUsage } from '../types/thread.js';

export const ACP_PROTOCOL_VERSION = 1;
export const ACP_REPLAY_CHAR_BUDGET = 16_000;

export type AcpMcpServer = {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
};

export type AcpPermissionMode = 'plan' | 'default' | 'full';

export type AcpPermissionOption = {
  optionId: string;
  kind: string;
  name?: string;
};

export type AcpTranscriptTurn = {
  role: 'user' | 'agent' | 'summary';
  text: string;
};

/** Plan mode may allow these. Anything else, including a missing kind, is refused. */
const PLAN_READ_TOOL_KINDS = new Set(['read', 'search', 'think']);

/**
 * One user stdio MCP entry (Claude `mcpServers` shape). HTTP/SSE entries and
 * rows without a command are skipped — the harness launches stdio servers.
 */
export function acpStdioServerFromEntry(
  name: string,
  entry: Record<string, unknown>,
): AcpMcpServer | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const type = typeof entry.type === 'string' ? entry.type : '';
  if (type === 'http' || type === 'sse' || typeof entry.url === 'string') return null;
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  if (!command) return null;
  const args = Array.isArray(entry.args)
    ? entry.args.filter((item): item is string => typeof item === 'string')
    : [];
  const env: Array<{ name: string; value: string }> = [];
  const rawEnv = entry.env;
  if (rawEnv && typeof rawEnv === 'object' && !Array.isArray(rawEnv)) {
    for (const [key, value] of Object.entries(rawEnv)) {
      if (key === 'ELECTRON_RUN_AS_NODE' || typeof value !== 'string') continue;
      env.push({ name: key, value });
    }
  }
  return { name: trimmed, command, args, env };
}

/** User stdio servers whose names are not already injected. */
export function acpUserStdioServers(
  entries: Record<string, Record<string, unknown>>,
  taken: ReadonlySet<string>,
): AcpMcpServer[] {
  const out: AcpMcpServer[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (taken.has(name.trim())) continue;
    const server = acpStdioServerFromEntry(name, entry);
    if (server) out.push(server);
  }
  return out;
}

export function toAcpMcpServers(
  servers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>,
): AcpMcpServer[] {
  return servers.map((server) => ({
    name: server.name,
    command: server.command,
    args: server.args ?? [],
    env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
  }));
}

/**
 * `load` only when the harness advertised `loadSession` and this chat already
 * has an id from that harness. Anything else is a new session.
 */
export function acpSessionOpenPlan(input: {
  loadSession: boolean;
  sessionId: string | null | undefined;
}): 'load' | 'new' {
  if (input.loadSession && input.sessionId?.trim()) return 'load';
  return 'new';
}

/** Drop the current user turn (already stored) so replay does not repeat it. */
export function acpPriorTranscript(
  messages: Array<{ role: string; text?: string | null }>,
): AcpTranscriptTurn[] {
  const rows: AcpTranscriptTurn[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'agent' && message.role !== 'summary') {
      continue;
    }
    const text = message.text?.trim() ?? '';
    if (!text) continue;
    rows.push({ role: message.role, text });
  }
  const last = rows[rows.length - 1];
  if (last?.role === 'user') rows.pop();
  return rows;
}

export function buildAcpReplayPrompt(
  prior: readonly AcpTranscriptTurn[],
  prompt: string,
): string {
  if (prior.length === 0) return prompt;
  const lines = prior.map((turn) => {
    const who = turn.role === 'user' ? 'User' : turn.role === 'agent' ? 'Assistant' : 'Note';
    return `${who}:\n${turn.text}`;
  });
  let body = lines.join('\n\n');
  if (body.length > ACP_REPLAY_CHAR_BUDGET) {
    body = `…(earlier turns omitted)\n\n${body.slice(body.length - ACP_REPLAY_CHAR_BUDGET)}`;
  }
  return [
    'Previous conversation (this harness cannot load a saved session, so Sideboard replayed the transcript):',
    body,
    'Current request:',
    prompt,
  ].join('\n\n');
}

export function selectAcpPermissionOption(
  options: readonly AcpPermissionOption[],
  mode: AcpPermissionMode,
  toolKind?: string | null,
): { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } {
  const allowAlways = options.find((option) => option.kind === 'allow_always');
  const allowOnce = options.find((option) => option.kind === 'allow_once');
  const rejectOnce = options.find((option) => option.kind === 'reject_once');
  const rejectAlways = options.find((option) => option.kind === 'reject_always');
  if (mode === 'plan') {
    if (toolKind && PLAN_READ_TOOL_KINDS.has(toolKind)) {
      const allow = allowOnce ?? allowAlways;
      if (allow) return { outcome: 'selected', optionId: allow.optionId };
    }
    const reject = rejectOnce ?? rejectAlways;
    if (reject) return { outcome: 'selected', optionId: reject.optionId };
    return { outcome: 'cancelled' };
  }
  if (mode === 'full') {
    const allow = allowAlways ?? allowOnce;
    if (allow) return { outcome: 'selected', optionId: allow.optionId };
  }
  const allow = allowOnce ?? allowAlways;
  if (allow) return { outcome: 'selected', optionId: allow.optionId };
  const reject = rejectOnce ?? rejectAlways;
  if (reject) return { outcome: 'selected', optionId: reject.optionId };
  return { outcome: 'cancelled' };
}

function clip(text: string, max = 8_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(${text.length - max} more characters)`;
}

function blockToText(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const record = block as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  if (typeof record.path === 'string' && (record.type === 'diff' || record.type === 'resource')) {
    return record.path;
  }
  return '';
}

export function acpContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  const blocks = Array.isArray(content) ? content : content ? [content] : [];
  return blocks.map(blockToText).filter(Boolean).join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function acpUsageFromUnknown(value: unknown): TokenUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  const input = num(record.inputTokens ?? record.input_tokens);
  const output = num(record.outputTokens ?? record.output_tokens);
  if (input == null && output == null) return null;
  const cacheRead = num(record.cacheReadTokens ?? record.cachedReadTokens ?? record.cached_read_tokens);
  const cacheWrite = num(
    record.cacheWriteTokens ?? record.cachedWriteTokens ?? record.cached_write_tokens,
  );
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    ...(cacheRead != null ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite != null ? { cacheWriteTokens: cacheWrite } : {}),
  };
}

function toolInput(raw: unknown): Record<string, unknown> | undefined {
  const record = asRecord(raw);
  return record ?? undefined;
}

/** Map one `session/update` params object to Sideboard events. */
export function sessionUpdateToEvents(params: unknown): AgentEvent[] {
  const root = asRecord(params);
  const update = asRecord(root?.update) ?? root;
  if (!update) return [];
  const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';
  if (kind === 'user_message_chunk') return [];
  if (kind === 'agent_message_chunk') {
    const text = acpContentToText(update.content);
    return text ? [{ type: 'stdout', data: text }] : [];
  }
  if (kind === 'agent_thought_chunk') {
    const text = acpContentToText(update.content);
    return text ? [{ type: 'thinking', data: text }] : [];
  }
  if (kind === 'plan') {
    const entries = Array.isArray(update.entries) ? update.entries : [];
    const text = entries
      .map((entry) => {
        const record = asRecord(entry);
        return typeof record?.content === 'string' ? record.content : '';
      })
      .filter(Boolean)
      .join('\n');
    return text ? [{ type: 'thinking', data: text }] : [];
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!id) return [];
    const name =
      (typeof update.title === 'string' && update.title) ||
      (typeof update.kind === 'string' && update.kind) ||
      'tool';
    const status = typeof update.status === 'string' ? update.status : '';
    const content = clip(acpContentToText(update.content ?? update.rawOutput));
    const events: AgentEvent[] = [];
    if (kind === 'tool_call') {
      events.push({
        type: 'tool_use',
        id,
        name,
        ...(toolInput(update.rawInput) ? { input: toolInput(update.rawInput) } : {}),
      });
    }
    if (status === 'completed' || status === 'failed' || (kind === 'tool_call_update' && content)) {
      events.push({
        type: 'tool_result',
        id,
        ...(content ? { content } : {}),
        isError: status === 'failed',
        partial: status !== 'completed' && status !== 'failed',
      });
    }
    return events;
  }
  return [];
}

const AGENT_EVENT_TYPES = new Set([
  'stdout',
  'stderr',
  'session_id',
  'thinking',
  'tool_use',
  'tool_result',
  'usage',
  'exit',
]);

export function parseAcpRunnerLine(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    if (typeof parsed.type !== 'string' || !AGENT_EVENT_TYPES.has(parsed.type)) return null;
    return parsed as AgentEvent;
  } catch {
    return null;
  }
}
