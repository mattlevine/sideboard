import type { AgentEvent, TokenUsage } from '../types/thread.js';
import { extractJsonErrorMessage, formatUnknownDetail } from './error-detail.js';

/** JSON payload written to the Cursor runner on stdin. */
export type CursorTurnRequest = {
  prompt: string;
  cwd: string;
  /** Isolates the JSONL catalog so concurrent Cursor runners do not clobber runs. */
  threadId?: string | null;
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
      type?: 'stdio';
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
  run_id?: string;
};

function usageFromCursor(usage: CursorSdkStreamMessage['usage']): TokenUsage | null {
  if (!usage) return null;
  // Cursor SDK TokenUsage is Claude-shaped: inputTokens is uncached; cache
  // read/write are extra (`totalTokens` sums all four). Do not subtract.
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

/** Cursor SDK `UsageCost` — dollar amounts in float cents. */
export type CursorUsageCost = {
  chargedCents?: number;
  rawCostCents?: number;
};

export type CursorRunUsageSnapshot = {
  runId: string;
  cost?: CursorUsageCost;
};

/** Subset of `agent.getUsage()` used for turn-scoped cost. */
export type CursorAgentUsageSnapshot = {
  cost?: CursorUsageCost;
  runs?: CursorRunUsageSnapshot[];
};

/**
 * Prefer actually charged cents; fall back to raw model cost (plan / BYOK /
 * credit-grant turns often report chargedCents=0).
 */
export function preferredCursorCostCents(
  cost?: CursorUsageCost | null,
): number | undefined {
  if (!cost) return undefined;
  const charged = Number(cost.chargedCents);
  const raw = Number(cost.rawCostCents);
  if (Number.isFinite(charged) && charged > 0) return charged;
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (Number.isFinite(charged)) return charged;
  if (Number.isFinite(raw)) return raw;
  return undefined;
}

/**
 * Turn-scoped USD from before/after `agent.getUsage()` snapshots.
 * Prefers cost on newly appeared runs; else agent-level cents delta when a
 * before snapshot exists. Returns undefined when cost is not reported yet
 * (eventually consistent) or when there is no safe turn baseline.
 */
export function turnCostUsdFromCursorUsage(
  before: CursorAgentUsageSnapshot | null | undefined,
  after: CursorAgentUsageSnapshot | null | undefined,
): number | undefined {
  if (!after) return undefined;
  const beforeIds = new Set((before?.runs ?? []).map((r) => r.runId));
  const newRuns = (after.runs ?? []).filter((r) => !beforeIds.has(r.runId));
  let sum = 0;
  let any = false;
  for (const r of newRuns) {
    const c = preferredCursorCostCents(r.cost);
    if (c != null) {
      sum += c;
      any = true;
    }
  }
  if (any) return sum / 100;

  // Without a before snapshot, agent.cost is session-cumulative — do not assign
  // the whole agent total to this turn.
  if (before == null) return undefined;
  const afterCents = preferredCursorCostCents(after.cost);
  if (afterCents == null) return undefined;
  const beforeCents = preferredCursorCostCents(before.cost) ?? 0;
  const delta = afterCents - beforeCents;
  if (!(delta >= 0) || !Number.isFinite(delta)) return undefined;
  return delta / 100;
}

/** Turn cost for one `getUsage().runs[]` entry (usage UUID on local agents). */
export function costUsdFromRunSnapshot(
  usage: CursorAgentUsageSnapshot | null | undefined,
  runId: string,
): number | undefined {
  if (!usage?.runs?.length || !runId.trim()) return undefined;
  const row = usage.runs.find((r) => r.runId === runId);
  const cents = preferredCursorCostCents(row?.cost);
  return cents != null ? cents / 100 : undefined;
}

/**
 * Local `getUsage({ runId })` rejects client `run-<uuid>` stream labels — only
 * pass usage UUIDs from `getUsage().runs[].runId`.
 */
export function cursorGetUsageRunId(runId: string | undefined | null): string | undefined {
  const id = runId?.trim();
  if (!id || id.startsWith('run-')) return undefined;
  return id;
}

const CURSOR_COST_POLL_MS = [0, 400, 800, 1600, 3200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll `agent.getUsage()` until turn-scoped USD appears or retries exhaust.
 * Cursor billing is eventually consistent — a single post-wait read often misses cost.
 */
export async function fetchCursorTurnCostUsd(
  getUsage: (opts?: { runId?: string }) => Promise<CursorAgentUsageSnapshot>,
  usageBefore: CursorAgentUsageSnapshot | null,
  opts?: { runId?: string },
): Promise<number | undefined> {
  const lookupRunId = cursorGetUsageRunId(opts?.runId);
  for (const delay of CURSOR_COST_POLL_MS) {
    if (delay > 0) await sleep(delay);
    try {
      if (lookupRunId) {
        const scoped = await getUsage({ runId: lookupRunId });
        const direct = costUsdFromRunSnapshot(scoped, lookupRunId);
        if (direct != null) return direct;
      }
      const after = await getUsage();
      const delta = turnCostUsdFromCursorUsage(usageBefore, after);
      if (delta != null) return delta;
    } catch (err) {
      if (isCursorUsageUnavailableError(err)) return undefined;
      /* billing may still be landing — retry */
    }
  }
  return undefined;
}

/** Cursor `agent.getUsage()` is not enabled for every API key / plan. */
export function isCursorUsageUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /feature_unavailable|feature unavailable|not available for your account/i.test(msg);
}

/** Cost-only turn usage event for the Cursor runner → spawn fold. */
export function cursorCostOnlyUsageEvent(costUsd: number): AgentEvent {
  return {
    type: 'usage',
    data: { inputTokens: 0, outputTokens: 0, costUsd },
    scope: 'turn',
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
      const events: AgentEvent[] = [
        {
          type: 'tool_use',
          id: msg.call_id,
          name: normalized.name,
          input: normalized.input,
        },
      ];
      const live = unwrapCursorToolResult(msg.result);
      if (live) {
        events.push({
          type: 'tool_result',
          id: msg.call_id,
          content: live,
          partial: true,
        });
      }
      return events;
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

/**
 * Subset of Cursor SDK `InteractionUpdate` used for nested Task / Agent streams.
 * Tests stay free of the SDK package.
 */
export type CursorInteractionUpdate = {
  type?: string;
  text?: string;
  callId?: string;
  toolCall?: { type?: string; args?: unknown; result?: unknown };
  taskUpdate?: CursorInteractionUpdate;
};

function nestedUpdateToEvents(
  update: CursorInteractionUpdate,
  parentId: string,
): AgentEvent[] {
  if (update.type === 'thinking-delta' && update.text) {
    return [{ type: 'thinking', data: update.text, parentId }];
  }
  if (update.type === 'text-delta' && update.text) {
    return [{ type: 'stdout', data: update.text, parentId }];
  }
  if (
    (update.type === 'tool-call-started' || update.type === 'tool-call-completed') &&
    update.callId &&
    update.toolCall
  ) {
    const rawName = typeof update.toolCall.type === 'string' ? update.toolCall.type : 'tool';
    const normalized = normalizeCursorToolCall(rawName, update.toolCall.args);
    const events: AgentEvent[] = [
      {
        type: 'tool_use',
        id: update.callId,
        name: normalized.name,
        input: normalized.input,
        parentId,
      },
    ];
    if (update.type === 'tool-call-completed') {
      events.push({
        type: 'tool_result',
        id: update.callId,
        content: unwrapCursorToolResult(update.toolCall.result),
        isError: cursorToolResultIsError(undefined, update.toolCall.result),
        parentId,
      });
    } else {
      const live = unwrapCursorToolResult(update.toolCall.result);
      if (live) {
        events.push({
          type: 'tool_result',
          id: update.callId,
          content: live,
          partial: true,
          parentId,
        });
      }
    }
    return events;
  }
  return [];
}

/**
 * Map a Cursor `send({ onDelta })` update to Sideboard events.
 * Only nested `tool-call-delta` is consumed — top-level text/thinking/tools
 * already arrive via `run.stream()` and must not be duplicated.
 */
export function cursorDeltaToEvents(update: CursorInteractionUpdate | null | undefined): AgentEvent[] {
  if (!update?.type) return [];
  if (update.type === 'tool-call-delta' && update.callId && update.taskUpdate) {
    return nestedUpdateToEvents(update.taskUpdate, update.callId);
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
