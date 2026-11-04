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

const SETTLED_THREAD_STATUSES = new Set(['idle', 'stopped', 'error', 'broken', 'archived']);

function matchingUserCount(
  messages: Array<{ role: string; text?: string; origin?: string }>,
  text: string,
): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === 'user' && message.origin !== 'continue' && message.text === text) {
      count += 1;
    }
  }
  return count;
}

/**
 * Streaming row for the open turn. Stop marks the thread `stopped` before the
 * partial reply is appended and before live paint is cleared, so settled
 * status hides only the empty thinking row. Text or tool parts stay visible
 * until that snapshot is gone.
 */
export function shouldShowStreamingTurn(input: {
  status: string;
  liveOutput: string;
  livePartCount: number;
  turnStartedAt?: number;
}): boolean {
  const hasLivePaint = Boolean(input.liveOutput) || input.livePartCount > 0;
  if (hasLivePaint) return true;
  if (SETTLED_THREAD_STATUSES.has(input.status)) return false;
  return input.status === 'running' || Boolean(input.turnStartedAt);
}

/**
 * A composer bubble that never matched a stored user message.
 * Keep it on the first paint and while a turn is still running. After the
 * thread moves on without that text, drop it — otherwise it sits under later
 * replies with the thinking row. A queued addition stays in the transcript
 * only while it is the prompt about to start.
 *
 * `seen` is how many copies of this text were already stored when the user
 * sent. A repeated prompt stays until a new copy lands. Omit it only for a
 * bubble with no send identity (a plan answer): any match then counts.
 */
export function shouldDropStalePendingUser(input: {
  text: string;
  messages: Array<{ role: string; text?: string; origin?: string }>;
  queue: string[];
  status: string;
  /** A later messages/queue/status snapshot than the one that showed this bubble. */
  threadMoved: boolean;
  seen?: number;
}): boolean {
  const matches = matchingUserCount(input.messages, input.text);
  const landed = input.seen == null ? matches > 0 : matches > input.seen;
  if (landed) return true;
  if (!input.threadMoved) return false;
  if (input.status === 'running') return false;
  if (input.queue.includes(input.text)) {
    // Waiting to start: the transcript shows that prompt. Once the turn has
    // stopped, the queue dock owns it so it is not pinned under later replies.
    return !(input.status === 'queued' && input.queue[0] === input.text);
  }
  return SETTLED_THREAD_STATUSES.has(input.status) || input.status === 'queued';
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
  // The queue head has not been consumed yet. An older message with the same
  // text is a previous send, not this one.
  if (input.currentTurnPrompt && !texts.includes(input.currentTurnPrompt)) {
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
 * A chip stays in this list while the saved queue is showing it (`queued`)
 * and after that row leaves the queue, until a new user message lands.
 * Dropping it in the gap before the transcript updates would charge that
 * send to the next same-text chip. `seen` is how many matching user
 * messages existed when the user sent.
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
    out.push(item);
  }
  return out;
}

/** Drop the chip the user just removed from the saved queue. */
export function dropRemovedFollowUp(pending: PendingFollowUp[], text: string): PendingFollowUp[] {
  const queuedIdx = pending.findIndex((item) => item.text === text && item.queued);
  const idx = queuedIdx >= 0 ? queuedIdx : pending.findIndex((item) => item.text === text);
  if (idx < 0) return pending;
  return pending.filter((_, i) => i !== idx);
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
