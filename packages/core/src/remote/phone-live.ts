import type { AgentEvent, MessagePart } from '../types/thread.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { outboundReplyFromTurn } from '../orchestrator/outbound-turn-reply.js';
import { extractPendingPlanQuestions } from '../plan/ask-user.js';
import { readThread } from '../store/thread-store.js';
import type { RemoteAskQuestion } from './protocol.js';
import { encodePhoneControl, readPhoneThread, type PhoneControlReply } from './phone-chats.js';
import { phoneArtifactText } from './phone-artifact.js';
import {
  PHONE_STREAM_FLUSH_MS,
  phoneStreamFlushNow,
  phoneStreamFrame,
  phoneStreamParts,
} from './phone-stream.js';

export const REMOTE_STOPPED_REPLY = 'Sideboard stopped the in-progress turn.';

export type RemoteOutbound =
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: RemoteAskQuestion[] };

const chatChains = new Map<string, Promise<void>>();
export const chatGeneration = new Map<string, number>();
/** Phone turn already being watched. Reopen must not bump this generation. */
export const phoneTurnGen = new Map<string, number>();

/**
 * Phone text → Global orchestrator on this Mac → reply or ask_user buttons.
 * Same turn loop as Slack Listen, without Slack.
 */
export function bumpChat(chatId: string): number {
  const next = (chatGeneration.get(chatId) ?? 0) + 1;
  chatGeneration.set(chatId, next);
  return next;
}

export function finishPhoneTurn(chatId: string, generation: number): void {
  if (phoneTurnGen.get(chatId) === generation) phoneTurnGen.delete(chatId);
}

export function enqueueChat(chatId: string, fn: () => Promise<void>): void {
  const prev = chatChains.get(chatId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chatChains.set(
    chatId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
}

export function emitControl(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  reply: PhoneControlReply,
): void {
  opts.onOutbound({ type: 'assistant', text: encodePhoneControl(reply) });
}

/**
 * Push the same live answer the desktop paints: markdown text plus the
 * activity line (Thinking / tool). Throttled like a frame, flushed on tools.
 */
export function watchPhoneStream(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  chatId: string,
  threadId: string,
  generation: number,
): () => void {
  let parts: MessagePart[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';
  let closed = false;
  const alive = () => !closed && chatGeneration.get(chatId) === generation;
  const flush = () => {
    timer = null;
    if (!alive()) return;
    const frame = phoneStreamFrame(parts);
    const key = `${frame.activity}\n${frame.text}`;
    if (key === lastKey) return;
    if (!frame.text && !frame.activity) return;
    lastKey = key;
    emitControl(opts, { op: 'stream', chatId, text: frame.text, activity: frame.activity });
  };
  const schedule = (event: AgentEvent) => {
    if (phoneStreamFlushNow(event) || lastKey === '') {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
      return;
    }
    if (timer) return;
    timer = setTimeout(flush, PHONE_STREAM_FLUSH_MS);
  };
  const off = getOrchestrator().on((event) => {
    if (!alive()) return;
    if (event.type !== 'turn_output' || event.threadId !== threadId) return;
    const next = phoneStreamParts(parts, event.event);
    if (!next) return;
    parts = next;
    schedule(event.event);
  });
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    off();
  };
}

export function interruptChat(chatId: string, log: (line: string) => void): boolean {
  try {
    const thread = readPhoneThread(chatId);
    if (!thread) return false;
    if (thread.status !== 'running' && thread.status !== 'queued') return false;
    getOrchestrator().stop(thread.id, { clearQueue: true });
    log(`interrupt phone → chat ${thread.id.slice(0, 8)} (${thread.status})`);
    return true;
  } catch (err) {
    log(`interrupt chat: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function emitChatTurn(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  chatId: string,
  threadId: string,
): void {
  const thread = readThread(threadId);
  if (!thread) {
    emitControl(opts, { op: 'error', chatId, message: 'That agent is not on this Mac.' });
    return;
  }
  if (thread.status === 'stopped') {
    emitControl(opts, { op: 'stopped', chatId });
    return;
  }
  const result = getOrchestrator().getTurnResult(thread.id);
  const pending = extractPendingPlanQuestions(
    [...thread.messages].reverse().find((m) => m.role === 'agent')?.parts,
  );
  if (result.taskState === 'input-required' && pending) {
    emitControl(opts, {
      op: 'ask',
      chatId,
      text: result.text.trim(),
      questions: pending.questions.map((q) => ({
        question: q.question,
        options: q.options.map((o) =>
          o.description ? { label: o.label, description: o.description } : { label: o.label },
        ),
      })),
    });
    return;
  }
  const reply = outboundReplyFromTurn(result, {
    inputRequired: 'Sideboard is waiting for an answer.',
    canceled: REMOTE_STOPPED_REPLY,
    completedEmpty: () => '',
    failed: (detail) =>
      detail ? `Sideboard failed: ${detail}` : 'Sideboard failed before producing a result.',
  });
  const agent = [...thread.messages].reverse().find((m) => m.role === 'agent');
  emitControl(opts, {
    op: 'assistant',
    chatId,
    text: phoneArtifactText(reply.trim(), agent?.parts),
  });
}

/**
 * List, create, open, archive, and restore chats.
 * Runs outside the single-coordinator queue so one agent does not block the list.
 */
export function phoneError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Wait out a turn that create already started, then send assistant or ask. */
export function deliverPhoneTurn(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  chatId: string,
): void {
  const thread = readPhoneThread(chatId);
  if (!thread || (thread.status !== 'running' && thread.status !== 'queued')) return;
  const id = thread.id;
  // Opening the chat again shares the watcher. A new bump would drop frames
  // until the original waitForTurn finished.
  const claimed = phoneTurnGen.get(id);
  if (claimed != null && claimed === chatGeneration.get(id)) return;
  const generation = bumpChat(id);
  phoneTurnGen.set(id, generation);
  enqueueChat(id, async () => {
    if (chatGeneration.get(id) !== generation) return;
    const stopStream = watchPhoneStream(opts, id, id, generation);
    try {
      await getOrchestrator().waitForTurn(id, 14 * 60 * 1000);
    } catch (err) {
      stopStream();
      finishPhoneTurn(id, generation);
      if (chatGeneration.get(id) !== generation) return;
      emitControl(opts, { op: 'error', chatId: id, message: `Sideboard failed: ${phoneError(err)}` });
      return;
    }
    stopStream();
    finishPhoneTurn(id, generation);
    if (chatGeneration.get(id) !== generation) return;
    emitChatTurn(opts, id, id);
  });
}
