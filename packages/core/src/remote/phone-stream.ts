import { applyAgentEvent, liveActivitySummary, visibleAssistantText } from '../agents/message-parts.js';
import type { AgentEvent, MessagePart } from '../types/thread.js';

/** Coalesce token deltas before the next phone frame. Desktop paints on animation frames. */
export const PHONE_STREAM_FLUSH_MS = 80;

export function phoneStreamFrame(parts: MessagePart[]): { text: string; activity: string } {
  return {
    text: visibleAssistantText(undefined, parts),
    activity: liveActivitySummary(parts),
  };
}

/** Shimmer label. Empty while the answer itself is the live signal. */
export function phoneStreamVerb(activity: string, hasText: boolean): string {
  const trimmed = activity.trim();
  const quiet = !trimmed || trimmed === 'Working…' || trimmed === 'Writing reply…';
  if (!hasText) return quiet ? 'Thinking' : trimmed;
  return quiet ? '' : trimmed;
}

const SKIPPED = new Set<AgentEvent['type']>(['session_id', 'usage', 'stderr', 'exit']);

export function phoneStreamParts(parts: MessagePart[], event: AgentEvent): MessagePart[] | null {
  if (SKIPPED.has(event.type)) return null;
  return applyAgentEvent(parts, event);
}

export function phoneStreamFlushNow(event: AgentEvent): boolean {
  return event.type === 'tool_use' || (event.type === 'tool_result' && !event.partial);
}
