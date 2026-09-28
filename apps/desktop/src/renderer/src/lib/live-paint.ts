import type { AgentEvent, MessagePart, TokenUsage } from '@sideboard-ai/core';
import {
  applyAgentEvent,
  looksLikeIncompleteSkillDump,
  looksLikeSkillBody,
  messagePartParentId,
  partsToAssistantText,
  THINKING_PART_MAX_CHARS,
} from '@sideboard/message-parts';
import { applyTurnUsage } from '@sideboard/usage';

/** Live board/chat only — persisted transcripts keep the full turn. */
export const LIVE_OUTPUT_MAX_CHARS = 4_000;
export const LIVE_TEXT_PART_MAX_CHARS = THINKING_PART_MAX_CHARS;
export const LIVE_PARTS_MAX = 80;

function clipLiveTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - Math.max(1, max - 1))}`;
}

/**
 * Keep ancestor tool cards for any trimmed nested part. Dropping a Task parent
 * promotes its one-word tool-use stream into the top-level answer.
 */
function withAncestorTools(all: MessagePart[], kept: MessagePart[]): MessagePart[] {
  const byId = new Map<string, Extract<MessagePart, { type: 'tool' }>>();
  for (const part of all) {
    if (part.type === 'tool') byId.set(part.id, part);
  }
  const keptToolIds = new Set(
    kept.filter((p): p is Extract<MessagePart, { type: 'tool' }> => p.type === 'tool').map((p) => p.id),
  );
  const extraIds = new Set<string>();
  const queue: string[] = [];
  for (const part of kept) {
    const parentId = messagePartParentId(part);
    if (parentId) queue.push(parentId);
  }
  while (queue.length) {
    const id = queue.pop()!;
    if (keptToolIds.has(id) || extraIds.has(id)) continue;
    const parent = byId.get(id);
    if (!parent) continue;
    extraIds.add(id);
    const next = messagePartParentId(parent);
    if (next) queue.push(next);
  }
  if (extraIds.size === 0) return kept;
  const extras = all.filter((p) => p.type === 'tool' && extraIds.has(p.id));
  return [...extras, ...kept];
}

export function slimLiveParts(parts: MessagePart[]): MessagePart[] {
  const clipped = parts.map((p) => {
    if (p.type === 'text' && p.text.length > LIVE_TEXT_PART_MAX_CHARS) {
      return { ...p, text: clipLiveTail(p.text, LIVE_TEXT_PART_MAX_CHARS) };
    }
    return p;
  });
  if (clipped.length <= LIVE_PARTS_MAX) return clipped;
  return withAncestorTools(clipped, clipped.slice(-Math.floor(LIVE_PARTS_MAX / 2)));
}

export type LivePaintOp =
  | { kind: 'output'; threadId: string; event: AgentEvent }
  | { kind: 'started'; threadId: string }
  | { kind: 'clear'; threadId: string };

export type LivePaintState = {
  output: Record<string, string>;
  parts: Record<string, MessagePart[]>;
  startedAt: Record<string, number>;
  usage: Record<string, TokenUsage | null>;
};

/** Raw CLI JSON dumps should not accumulate in the board preview string. */
export function stdoutCountsAsLivePreview(event: AgentEvent): boolean {
  return (
    event.type === 'stdout' &&
    !event.parentId &&
    !looksLikeSkillBody(event.data) &&
    !looksLikeIncompleteSkillDump(event.data) &&
    !(
      /^\s*\{/.test(event.data) &&
      /"type"\s*:\s*"(tool_use|tool_result|tool|thinking|usage|done|error)"/.test(
        event.data,
      )
    )
  );
}

export function foldLivePaintOps(
  state: LivePaintState,
  ops: LivePaintOp[],
  now: number,
): LivePaintState {
  let { output, parts, startedAt, usage } = state;
  for (const op of ops) {
    if (op.kind === 'started') {
      output = { ...output, [op.threadId]: '' };
      parts = { ...parts, [op.threadId]: [] };
      startedAt = { ...startedAt, [op.threadId]: now };
      usage = { ...usage, [op.threadId]: null };
      continue;
    }
    if (op.kind === 'clear') {
      output = { ...output };
      parts = { ...parts };
      startedAt = { ...startedAt };
      usage = { ...usage };
      delete output[op.threadId];
      delete parts[op.threadId];
      delete startedAt[op.threadId];
      delete usage[op.threadId];
      continue;
    }
    const ev = op.event;
    if (
      ev.type === 'stdout' ||
      ev.type === 'thinking' ||
      ev.type === 'tool_use' ||
      ev.type === 'tool_result'
    ) {
      const nextParts = slimLiveParts(applyAgentEvent(parts[op.threadId] ?? [], ev));
      parts = {
        ...parts,
        [op.threadId]: nextParts,
      };
      output = {
        ...output,
        [op.threadId]: clipLiveTail(partsToAssistantText(nextParts), LIVE_OUTPUT_MAX_CHARS),
      };
    }
    if (ev.type === 'usage') {
      usage = {
        ...usage,
        [op.threadId]: applyTurnUsage(
          usage[op.threadId] ?? null,
          ev.data,
          ev.scope ?? 'request',
        ),
      };
    }
  }
  return { output, parts, startedAt, usage };
}
