import { contextTokens } from '../agents/usage.js';
import type { MessagePart, Thread, ThreadMessage } from '../types/thread.js';
import {
  applyForwardOccupancy,
  estimateMessageChars,
  estimateThreadChars,
} from './context-estimate.js';
import { summarizeConversation } from './summarize.js';

export {
  applyForwardOccupancy,
  CHARS_PER_CONTEXT_TOKEN,
  estimateMessageChars,
  estimateOccupancyTokens,
  estimateThreadChars,
  forwardContextUsage,
  forwardOccupancyTokens,
  threadHasCompactedContext,
} from './context-estimate.js';

/**
 * Sideboard transcript budget before summarizing older turns for the board /
 * future seed (≈ 100k tokens at ~4 chars/token). Independent of the CLI
 * session — compacting the store does not clear sessionId.
 */
export const CONTEXT_COMPACT_CHARS = 400_000;
/** Keep this much recent transcript after compaction. */
export const CONTEXT_KEEP_RECENT_CHARS = 24_000;
/** Always keep at least this many trailing messages. */
export const CONTEXT_KEEP_RECENT_MESSAGES = 12;
/** Don't bother compacting tiny threads. */
export const CONTEXT_MIN_MESSAGES = 10;
/**
 * Last-request occupancy at which the next turn should start a fresh CLI
 * session (seeded from the compacted transcript). ~75% of the 1M ring.
 * Below this, keep sessionId so prompt cache survives.
 */
export const SESSION_RESET_OCCUPANCY_TOKENS = 750_000;

export interface CompactThresholds {
  maxChars?: number;
  keepRecentChars?: number;
  keepRecentMessages?: number;
  minMessages?: number;
}

export function shouldCompactContext(
  messages: ThreadMessage[],
  thresholds: CompactThresholds = {},
): boolean {
  const maxChars = thresholds.maxChars ?? CONTEXT_COMPACT_CHARS;
  const minMessages = thresholds.minMessages ?? CONTEXT_MIN_MESSAGES;
  if (messages.length < minMessages) return false;
  return estimateThreadChars(messages) >= maxChars;
}

/** Split into older (to summarize) + recent (kept verbatim). */
export function splitForCompaction(
  messages: ThreadMessage[],
  thresholds: CompactThresholds = {},
): { older: ThreadMessage[]; recent: ThreadMessage[] } {
  const keepChars = thresholds.keepRecentChars ?? CONTEXT_KEEP_RECENT_CHARS;
  const keepCount = thresholds.keepRecentMessages ?? CONTEXT_KEEP_RECENT_MESSAGES;

  if (messages.length === 0) return { older: [], recent: [] };

  let recentChars = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const next = recentChars + estimateMessageChars(messages[i]!);
    const kept = messages.length - i;
    if (kept >= keepCount && next > keepChars) break;
    recentChars = next;
    cut = i;
  }

  // Never summarize everything — leave at least a few recent turns.
  const minRecent = Math.min(keepCount, messages.length);
  cut = Math.min(cut, messages.length - minRecent);
  if (cut <= 0) return { older: [], recent: messages };

  return {
    older: messages.slice(0, cut),
    recent: messages.slice(cut),
  };
}

export type TranscriptToolDetail = 'full' | 'summary' | 'none';

function formatToolPart(
  t: Extract<MessagePart, { type: 'tool' }>,
  detail: Exclude<TranscriptToolDetail, 'none'>,
): string {
  if (detail === 'summary') {
    const label = t.description || t.detail || t.name;
    const path = t.filePath ? ` (${t.filePath})` : '';
    return `- ${t.name}: ${label}${path}`;
  }

  const lines = [`#### Tool: ${t.name}`, `Status: ${t.status}`];
  if (t.description) lines.push(`Description: ${t.description}`);
  if (t.filePath) lines.push(`Path: ${t.filePath}`);
  if (t.input && Object.keys(t.input).length > 0) {
    lines.push('Input:');
    lines.push('```json');
    lines.push(JSON.stringify(t.input, null, 2));
    lines.push('```');
  } else if (t.detail) {
    lines.push(`Detail: ${t.detail}`);
  }
  if (t.result != null && t.result !== '') {
    lines.push('Result:');
    lines.push('```');
    lines.push(t.result);
    lines.push('```');
  }
  return lines.join('\n');
}

/**
 * Format stored thread messages for agent context or summarization.
 * Use `tools: 'full'` when the transcript is sent back to the agent so tool
 * inputs/results are not truncated; `summary` keeps one-line tool labels for
 * compaction prompts.
 */
export function formatMessagesAsTranscript(
  messages: ThreadMessage[],
  opts?: { tools?: TranscriptToolDetail },
): string {
  const tools = opts?.tools ?? 'full';
  const blocks: string[] = [];
  for (const m of messages) {
    if (m.role === 'summary') {
      blocks.push(`## Prior summary\n${m.text}`);
      continue;
    }
    if (m.role === 'user') {
      blocks.push(`### User\n${m.text}`);
      continue;
    }
    const bits: string[] = [];
    if (m.text?.trim()) {
      bits.push(`### Agent\n${m.text}`);
    } else {
      bits.push('### Agent');
    }
    const thinking = (m.parts ?? []).filter((p) => p.type === 'thinking');
    for (const th of thinking) {
      if (th.type !== 'thinking' || !th.text.trim()) continue;
      bits.push('Thinking:');
      bits.push(th.text);
    }
    const toolParts = (m.parts ?? []).filter(
      (p): p is Extract<MessagePart, { type: 'tool' }> => p.type === 'tool',
    );
    if (tools !== 'none' && toolParts.length > 0) {
      if (tools === 'summary') bits.push('Tools:');
      for (const t of toolParts) {
        bits.push(formatToolPart(t, tools));
      }
    }
    blocks.push(bits.join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * Seed prompt for a fresh agent session (no --resume).
 * Includes summary + recent turns with full tool use data so continuity is not lost.
 * Pass `tools: 'none'` for hosts that choke on tool-heavy seeds (e.g. Brightsy).
 */
export function buildSessionSeed(
  messages: ThreadMessage[],
  opts?: { tools?: TranscriptToolDetail },
): string | null {
  if (messages.length === 0) return null;
  const body = formatMessagesAsTranscript(messages, { tools: opts?.tools ?? 'full' });
  if (!body.trim()) return null;
  return [
    'Sideboard conversation context (restored after compaction or a new session):',
    '',
    body,
    '',
    'Continue from this context. Do not repeat the summary unless asked.',
  ].join('\n');
}

/** Brightsy server tool that compresses chat history (`context_summary` payload). */
export const BRIGHTSY_SUMMARIZE_CONTEXT_TOOL = 'summarize_context';

/**
 * Pull the summary text from a Brightsy `summarize_context` tool result.
 * Successful payloads are `{ context_summary: "..." }`; failures are skipped.
 */
export function extractBrightsyContextSummary(
  result: string | undefined,
): string | null {
  if (!result?.trim()) return null;
  const trimmed = result.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('context summarization failed') ||
    lower.startsWith('nothing to summarize') ||
    lower.startsWith('no messages found') ||
    lower.startsWith('messages are required') ||
    lower.startsWith('agent id is required')
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      context_summary?: unknown;
      error?: unknown;
    };
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (parsed.error != null && typeof parsed.context_summary !== 'string') {
        return null;
      }
      if (
        typeof parsed.context_summary === 'string' &&
        parsed.context_summary.trim()
      ) {
        return parsed.context_summary.trim();
      }
      return null;
    }
  } catch {
    // plain-text summary
  }
  if (trimmed.includes('"error"') && !trimmed.includes('context_summary')) {
    return null;
  }
  return trimmed;
}

export function findLastBrightsyContextSummary(
  messages: ThreadMessage[],
): { index: number; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'agent') continue;
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool' || part.name !== BRIGHTSY_SUMMARIZE_CONTEXT_TOOL) {
        continue;
      }
      if (part.status === 'error') continue;
      const text = extractBrightsyContextSummary(part.result);
      if (text) return { index: i, text };
    }
  }
  return null;
}

/**
 * Messages Brightsy should see after its last successful `summarize_context`
 * tool (everything after that tool row). Matches Brightsy's own prompt
 * builder: drop history before the tool result, keep the tail. No last-N cap.
 * If the tool has never succeeded, return the full history.
 */
export function messagesSinceLastBrightsyContextSummary(
  messages: ThreadMessage[],
): ThreadMessage[] {
  const match = findLastBrightsyContextSummary(messages);
  if (!match) return messages;
  return messages.slice(match.index + 1);
}

/**
 * Brightsy `chat` is a stateless completion (one stdin blob, no --resume).
 * Seed the last `summarize_context` result plus every later turn, text-only
 * so other tool dumps do not empty-complete.
 */
export function buildBrightsySessionSeed(messages: ThreadMessage[]): string | null {
  const match = findLastBrightsyContextSummary(messages);
  const tail = match ? messages.slice(match.index + 1) : messages;
  const body = formatMessagesAsTranscript(tail, { tools: 'none' });
  if (!match && !body.trim()) return null;
  const blocks = [
    'Sideboard conversation context (restored after compaction or a new session):',
    '',
  ];
  if (match) {
    blocks.push(`## Prior summary\n${match.text}`, '');
  }
  if (body.trim()) {
    blocks.push(body, '');
  }
  blocks.push('Continue from this context. Do not repeat the summary unless asked.');
  return blocks.join('\n');
}

export function applyCompaction(
  messages: ThreadMessage[],
  summaryText: string,
  thresholds: CompactThresholds = {},
): ThreadMessage[] {
  const { older, recent } = splitForCompaction(messages, thresholds);
  if (older.length === 0) return messages;

  const summary: ThreadMessage = {
    role: 'summary',
    text: summaryText.trim(),
    ts: new Date().toISOString(),
  };
  return [summary, ...recent];
}

export interface CompactResult {
  didCompact: boolean;
  thread: Thread;
  summary?: string;
  method?: 'claude' | 'extractive';
  olderCount?: number;
}

/** Last agent turn's context-window occupancy, or 0. */
export function lastRequestOccupancy(thread: Pick<Thread, 'messages'>): number {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const usage = thread.messages[i]?.usage;
    if (usage) return contextTokens(usage);
  }
  return 0;
}

/**
 * True when the CLI session should be dropped so the next turn reseeds from
 * the (possibly compacted) Sideboard transcript instead of overflowing.
 */
export function shouldResetSessionForOccupancy(
  thread: Pick<Thread, 'messages'>,
  occupancyTokens: number = SESSION_RESET_OCCUPANCY_TOKENS,
): boolean {
  return lastRequestOccupancy(thread) >= occupancyTokens;
}

/**
 * If the thread transcript is oversized, summarize older turns and keep recent
 * ones. The CLI session stays unless last-request occupancy is near the window
 * — killing --resume on every compact was a full prompt-cache miss.
 */
export async function maybeCompactContext(
  thread: Thread,
  thresholds: CompactThresholds = {},
  summarize: typeof summarizeConversation = summarizeConversation,
): Promise<CompactResult> {
  if (!shouldCompactContext(thread.messages, thresholds)) {
    return { didCompact: false, thread };
  }

  const { older } = splitForCompaction(thread.messages, thresholds);
  if (older.length === 0) {
    return { didCompact: false, thread };
  }

  // Summarizer only needs labels — keep the prompt small. Full tool bodies stay
  // on recent messages and are included when seeding a new agent session.
  const transcript = formatMessagesAsTranscript(older, { tools: 'summary' });
  const { summary, method } = await summarize(transcript, {
    cwd: thread.worktreePath,
  });

  let messages = applyCompaction(thread.messages, summary, thresholds);
  const resetSession = shouldResetSessionForOccupancy({ messages: thread.messages });
  // Session reset reseeds from this transcript — persist going-forward occupancy
  // so the meter and lastRequestOccupancy match the compressed context.
  if (resetSession) {
    messages = applyForwardOccupancy(messages);
  }
  // Persist via caller (updateThread) — return the patched shape here.
  const next: Thread = {
    ...thread,
    messages,
    sessionId: resetSession ? null : thread.sessionId,
    updatedAt: new Date().toISOString(),
  };

  return {
    didCompact: true,
    thread: next,
    summary,
    method,
    olderCount: older.length,
  };
}
