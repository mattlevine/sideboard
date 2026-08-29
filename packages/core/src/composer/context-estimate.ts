import { contextTokens } from '../agents/usage.js';
import type { MessagePart, ThreadMessage, TokenUsage } from '../types/thread.js';

/** Same heuristic as `CONTEXT_COMPACT_CHARS` (≈ 100k tokens at 400k chars). */
export const CHARS_PER_CONTEXT_TOKEN = 4;

export function estimateMessageChars(message: ThreadMessage): number {
  let n = message.text.length + 16;
  for (const part of message.parts ?? []) {
    n += estimatePartChars(part);
  }
  return n;
}

function estimatePartChars(part: MessagePart): number {
  switch (part.type) {
    case 'text':
    case 'thinking':
      return part.text.length;
    case 'tool': {
      const input = part.input ? JSON.stringify(part.input) : '';
      return (
        part.name.length +
        (part.description?.length ?? 0) +
        (part.detail?.length ?? 0) +
        (part.result?.length ?? 0) +
        input.length +
        32
      );
    }
    default:
      return 0;
  }
}

export function estimateThreadChars(messages: ThreadMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageChars(m), 0);
}

/** Approximate tokens still occupying the window from the stored transcript. */
export function estimateOccupancyTokens(messages: ThreadMessage[]): number {
  return Math.ceil(estimateThreadChars(messages) / CHARS_PER_CONTEXT_TOKEN);
}

export function threadHasCompactedContext(
  messages: Array<Pick<ThreadMessage, 'role'>>,
): boolean {
  return messages.some((m) => m.role === 'summary');
}

/**
 * Occupancy the next turn will start from.
 * After Sideboard compression the last agent `lastRequestTokens` is still the
 * pre-summary peak — cap it to the remaining transcript so the meter shows
 * context going forward, not the compressed-away total.
 */
export function forwardContextUsage(
  usage: TokenUsage | null,
  messages: ThreadMessage[],
): TokenUsage | null {
  if (!usage) return null;
  if (!threadHasCompactedContext(messages)) return usage;
  const remaining = estimateOccupancyTokens(messages);
  const current = contextTokens(usage);
  if (remaining <= 0 || remaining >= current) return usage;
  return { ...usage, lastRequestTokens: remaining };
}

/** Persist going-forward occupancy on the latest agent usage (session reset). */
export function applyForwardOccupancy(messages: ThreadMessage[]): ThreadMessage[] {
  const tokens = estimateOccupancyTokens(messages);
  if (tokens <= 0) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'agent' || !m.usage) continue;
    const current = contextTokens(m.usage);
    if (tokens >= current) return messages;
    const next = messages.slice();
    next[i] = { ...m, usage: { ...m.usage, lastRequestTokens: tokens } };
    return next;
  }
  return messages;
}
