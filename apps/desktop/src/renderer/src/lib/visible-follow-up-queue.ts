import type { Thread } from '@sideboard-ai/core';

/**
 * `thread.queue` is the inbox for both follow-ups and the prompt that will
 * start next. The composer dock should only show follow-ups.
 */
export function splitTurnQueue(
  queue: string[],
  status: Thread['status'],
  turnBusy: boolean,
): { currentTurnPrompt: string | null; followUps: string[] } {
  const currentTurnPrompt =
    !turnBusy && status === 'queued' && queue.length > 0 ? queue[0]! : null;
  return {
    currentTurnPrompt,
    followUps: currentTurnPrompt ? queue.slice(1) : queue,
  };
}

export type PendingFollowUp = {
  id: string;
  text: string;
  seen?: number;
  /** This chip was matched to a saved queue row and is waiting to be sent or removed. */
  queued?: boolean;
};

/**
 * Optimistic follow-ups that have not landed in `thread.queue` yet.
 * Consumes matching persisted texts so the same prompt is not shown twice.
 */
/** Join a follow-up onto the prompt the agent has not answered yet. */
export function joinSteerPrompt(base: string, addition: string): string {
  const next = addition.trim();
  if (!next) return base;
  const head = base.replace(/\s+$/, '');
  if (!head) return next;
  return `${head}\n${next}`;
}

export type OptimisticUserSend = { text: string; seen: number };

/**
 * Optimistic sends that have not landed yet.
 * `seen` is how many matching user messages existed when the user sent, so an
 * older copy of the same text does not hide the new one.
 */
export function unlandedUserTexts<T extends OptimisticUserSend>(
  optimistic: T[],
  messages: Array<{ role: string; text?: string; origin?: string }>,
): T[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'user' || message.origin === 'continue') continue;
    const text = message.text ?? '';
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const out: T[] = [];
  for (const item of optimistic) {
    const now = counts.get(item.text) ?? 0;
    if (now > item.seen) {
      counts.set(item.text, now - 1);
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Transcript bubbles for sends that have not landed yet.
 * Composer sends are in `optimistic`. Plan answers, Implement plan, and Send
 * now only set `pendingUser`, so that text is included while it is in flight.
 */
export function pendingTranscriptTexts(input: {
  optimistic: OptimisticUserSend[];
  messages: Array<{ role: string; text?: string; origin?: string }>;
  currentTurnPrompt: string | null;
  pendingUser: string | null;
  pendingInTranscript: boolean;
}): string[] {
  const texts = unlandedUserTexts(input.optimistic, input.messages).map((item) => item.text);
  const landed = (text: string) =>
    input.messages.some((message) => message.role === 'user' && message.text === text);
  if (
    input.currentTurnPrompt &&
    !texts.includes(input.currentTurnPrompt) &&
    !landed(input.currentTurnPrompt)
  ) {
    texts.unshift(input.currentTurnPrompt);
  }
  if (
    input.pendingInTranscript &&
    input.pendingUser &&
    !texts.includes(input.pendingUser) &&
    !landed(input.pendingUser)
  ) {
    texts.push(input.pendingUser);
  }
  return texts;
}

/**
 * Optimistic queue chips that are still only local.
 * A chip stays in this list while the saved queue is showing it (`queued`),
 * so a later transcript row for that copy cannot be charged to the next
 * same-text send. Drop it once a new user message lands, or once a queued
 * chip leaves the queue without that message (the user removed it).
 * `seen` is how many matching user messages existed when the user sent.
 */
export function unlandedFollowUps(
  pending: PendingFollowUp[],
  queue: string[],
  messages: Array<{ role: string; text?: string; origin?: string }>,
): PendingFollowUp[] {
  const queued = new Map<string, number>();
  for (const text of queue) queued.set(text, (queued.get(text) ?? 0) + 1);
  const landed = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'user' || message.origin === 'continue') continue;
    const text = message.text ?? '';
    landed.set(text, (landed.get(text) ?? 0) + 1);
  }
  const out: PendingFollowUp[] = [];
  for (const item of pending) {
    const now = landed.get(item.text) ?? 0;
    if (now > (item.seen ?? 0)) {
      landed.set(item.text, now - 1);
      continue;
    }
    const inQueue = queued.get(item.text) ?? 0;
    if (inQueue > 0) {
      queued.set(item.text, inQueue - 1);
      out.push(item.queued ? item : { ...item, queued: true });
      continue;
    }
    if (item.queued) continue;
    out.push(item);
  }
  return out;
}

export function extraPendingFollowUps(
  followUps: string[],
  pending: PendingFollowUp[],
): PendingFollowUp[] {
  const remaining = new Map<string, number>();
  for (const text of followUps) {
    remaining.set(text, (remaining.get(text) ?? 0) + 1);
  }
  const extras: PendingFollowUp[] = [];
  for (const item of pending) {
    const count = remaining.get(item.text) ?? 0;
    if (count > 0) {
      remaining.set(item.text, count - 1);
      continue;
    }
    extras.push(item);
  }
  return extras;
}
