import type { AgentEvent, MessagePart, TokenUsage } from '@sideboard-ai/core';
import { applyAgentEvent, THINKING_PART_MAX_CHARS } from '@sideboard/message-parts';
import { applyTurnUsage } from '@sideboard/usage';

/** Live board/chat only — persisted transcripts keep the full turn. */
export const LIVE_OUTPUT_MAX_CHARS = 4_000;
export const LIVE_TEXT_PART_MAX_CHARS = THINKING_PART_MAX_CHARS;
export const LIVE_PARTS_MAX = 80;

function clipLiveTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - Math.max(1, max - 1))}`;
}

export function slimLiveParts(parts: MessagePart[]): MessagePart[] {
  const clipped = parts.map((p) => {
    if (p.type === 'text' && p.text.length > LIVE_TEXT_PART_MAX_CHARS) {
      return { ...p, text: clipLiveTail(p.text, LIVE_TEXT_PART_MAX_CHARS) };
    }
    return p;
  });
  if (clipped.length <= LIVE_PARTS_MAX) return clipped;
  return clipped.slice(-Math.floor(LIVE_PARTS_MAX / 2));
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
    if (stdoutCountsAsLivePreview(ev)) {
      const next = `${output[op.threadId] ?? ''}${ev.data}`;
      output = {
        ...output,
        [op.threadId]: clipLiveTail(next, LIVE_OUTPUT_MAX_CHARS),
      };
    }
    if (
      ev.type === 'stdout' ||
      ev.type === 'thinking' ||
      ev.type === 'tool_use' ||
      ev.type === 'tool_result'
    ) {
      parts = {
        ...parts,
        [op.threadId]: slimLiveParts(applyAgentEvent(parts[op.threadId] ?? [], ev)),
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
