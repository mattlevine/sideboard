import type { AgentEvent, MessagePart, TokenUsage } from '@sideboard-ai/core';
import { applyAgentEvent } from '@sideboard/message-parts';
import { applyTurnUsage } from '@sideboard/usage';

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
      output = { ...output, [op.threadId]: '' };
      parts = { ...parts, [op.threadId]: [] };
      startedAt = { ...startedAt };
      delete startedAt[op.threadId];
      usage = { ...usage };
      delete usage[op.threadId];
      continue;
    }
    const ev = op.event;
    if (stdoutCountsAsLivePreview(ev)) {
      output = {
        ...output,
        [op.threadId]: `${output[op.threadId] ?? ''}${ev.data}`,
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
        [op.threadId]: applyAgentEvent(parts[op.threadId] ?? [], ev),
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
