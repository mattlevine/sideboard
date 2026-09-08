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
  opts?: { tools?: TranscriptToolDetail; thinking?: boolean },
): string {
  const tools = opts?.tools ?? 'full';
  const thinking = opts?.thinking ?? true;
  return messages.map((m) => formatMessageBlock(m, { tools, thinking })).join('\n\n');
}

/** One transcript block for a stored message. */
function formatMessageBlock(
  m: ThreadMessage,
  opts: { tools: TranscriptToolDetail; thinking: boolean },
): string {
  if (m.role === 'summary') return `## Prior summary\n${m.text}`;
  if (m.role === 'user') return `### User\n${m.text}`;
  const bits: string[] = [];
  if (m.text?.trim()) {
    bits.push(`### Agent\n${m.text}`);
  } else {
    bits.push('### Agent');
  }
  if (opts.thinking) {
    for (const th of m.parts ?? []) {
      if (th.type !== 'thinking' || !th.text.trim()) continue;
      bits.push('Thinking:');
      bits.push(th.text);
    }
  }
  const toolParts = (m.parts ?? []).filter(
    (p): p is Extract<MessagePart, { type: 'tool' }> => p.type === 'tool',
  );
  if (opts.tools !== 'none' && toolParts.length > 0) {
    if (opts.tools === 'summary') bits.push('Tools:');
    for (const t of toolParts) {
      bits.push(formatToolPart(t, opts.tools));
    }
  }
  return bits.join('\n');
}

/**
 * Seed budget (chars) for a fresh agent session. The store compacts at
 * {@link CONTEXT_COMPACT_CHARS} (~100k tokens); re-sending that much as one
 * user message on every session reset is the single largest token cost, and
 * older tool dumps add nothing the agent cannot re-read from the worktree.
 */
export const SEED_MAX_CHARS = 60_000;
/** Trailing messages that keep full tool input/result in the seed. */
export const SEED_FULL_TOOL_MESSAGES = 6;

export interface SessionSeedOptions {
  /** Tool detail for the last {@link fullToolMessages} messages (default full). */
  tools?: TranscriptToolDetail;
  /** How many trailing messages get `tools`; older ones get one-line labels. */
  fullToolMessages?: number;
  /** Char budget for the transcript body (oldest blocks are dropped first). */
  maxChars?: number;
}

/**
 * Seed prompt for a fresh agent session (no --resume).
 * Prior summaries always survive. The last few turns keep full tool data so
 * continuity is not lost; older turns keep one-line tool labels; thinking is
 * never replayed. When the body still exceeds `maxChars`, the oldest
 * non-summary blocks are dropped and a marker notes how many.
 * Pass `tools: 'none'` for hosts that choke on tool-heavy seeds (e.g. Brightsy).
 */
export function buildSessionSeed(
  messages: ThreadMessage[],
  opts?: SessionSeedOptions,
): string | null {
  if (messages.length === 0) return null;
  const tools = opts?.tools ?? 'full';
  const fullCount = opts?.fullToolMessages ?? SEED_FULL_TOOL_MESSAGES;
  const maxChars = opts?.maxChars ?? SEED_MAX_CHARS;
  const olderTools: TranscriptToolDetail = tools === 'none' ? 'none' : 'summary';
  const fullFrom = Math.max(0, messages.length - fullCount);
  const blocks = messages.map((m, i) =>
    formatMessageBlock(m, {
      tools: i >= fullFrom ? tools : olderTools,
      thinking: false,
    }),
  );

  // Keep summaries + newest blocks within budget; drop oldest others first.
  const keep = new Array<boolean>(blocks.length).fill(false);
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (messages[i]!.role === 'summary') {
      keep[i] = true;
      used += blocks[i]!.length + 2;
    }
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (keep[i]) continue;
    const next = used + blocks[i]!.length + 2;
    if (next > maxChars && used > 0) break;
    keep[i] = true;
    used = next;
  }
  const dropped = keep.filter((k) => !k).length;
  const kept: string[] = [];
  let markerPlaced = false;
  for (let i = 0; i < blocks.length; i++) {
    if (!keep[i]) continue;
    if (dropped > 0 && !markerPlaced && messages[i]!.role !== 'summary') {
      kept.push(`_(${dropped} older message${dropped === 1 ? '' : 's'} omitted for length)_`);
      markerPlaced = true;
    }
    kept.push(blocks[i]!);
  }
  if (dropped > 0 && !markerPlaced) {
    kept.push(`_(${dropped} older message${dropped === 1 ? '' : 's'} omitted for length)_`);
  }
  const body = kept.join('\n\n');
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
  const body = formatMessagesAsTranscript(tail, { tools: 'none', thinking: false });
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
