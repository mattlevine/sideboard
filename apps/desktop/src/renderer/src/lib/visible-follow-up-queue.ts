import type { Thread, ThreadAttachment } from '@sideboard-ai/core';

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
  /** Files staged with this follow-up, shown until the saved queue row replaces the chip. */
  attachments?: ThreadAttachment[];
};

/**
 * Optimistic follow-ups that have not landed in `thread.queue` yet.
 * Consumes matching persisted texts so the same prompt is not shown twice.
 */
/**
 * Glue a follow-up onto the open composer bubble only while that prompt is
 * not already a transcript row. Once the earlier send is on screen, the next
 * one stays its own bubble — joining them showed both texts in one message
 * while the agent was still thinking.
 */
export function steerBubbleJoinsOntoOpenPrompt(input: {
  followUp: 'steer' | 'queue';
  agentReplying: boolean;
  openPrompt: string | null;
  messages: TranscriptMessage[];
}): boolean {
  if (input.followUp !== 'steer' || input.agentReplying || input.openPrompt == null) return false;
  return !openPromptAlreadyOnScreen(input.messages, input.openPrompt);
}

/** Join a follow-up onto the prompt the agent has not answered yet. */
export function joinSteerPrompt(base: string, addition: string): string {
  const next = addition.trim();
  if (!next) return base;
  const head = base.replace(/\s+$/, '');
  if (!head) return next;
  return `${head}\n${next}`;
}

export type OptimisticUserSend = {
  text: string;
  /** Exact copies of `text` already stored when the user sent. */
  seen: number;
  /**
   * Times `text` was already the join of one unanswered user run when the
   * user sent. Omitted on older rows; those compare joins against `seen`.
   */
  seenJoins?: number;
};

type TranscriptMessage = {
  role: string;
  text?: string;
  origin?: string;
  parts?: unknown[];
};

/**
 * The open prompt is already visible when one user row equals it, or when
 * consecutive stored rows join to it. A later follow-up must not be folded
 * back into one optimistic bubble.
 */
function openPromptAlreadyOnScreen(messages: TranscriptMessage[], openPrompt: string): boolean {
  const lines: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.origin === 'continue' || message.role === 'summary') continue;
    if (message.role === 'agent') {
      const text = (message.text ?? '').trim();
      const hasContent = Boolean(text) || (message.parts?.length ?? 0) > 0;
      if (hasContent && lines.length > 0) break;
      continue;
    }
    if (message.role !== 'user') continue;
    const text = message.text ?? '';
    if (text === openPrompt) return true;
    lines.unshift(text);
    let acc = lines[0] ?? '';
    for (let j = 1; j < lines.length; j++) acc = joinSteerPrompt(acc, lines[j] ?? '');
    if (acc === openPrompt) return true;
    if (acc.length > openPrompt.length) return false;
  }
  return false;
}

/**
 * How many times `text` is the join of one unanswered user run
 * (`joinSteerPrompt` of two or more lines). An agent or summary starts a new
 * run. A match consumes that run so a later pair counts again.
 */
export function countSteerJoins(text: string, messages: TranscriptMessage[]): number {
  if (!text.includes('\n')) return 0;
  let parts: string[] = [];
  let count = 0;
  const runMatches = () => {
    if (parts.length < 2) return false;
    let acc = parts[0] ?? '';
    for (let i = 1; i < parts.length; i++) acc = joinSteerPrompt(acc, parts[i] ?? '');
    return acc === text;
  };
  for (const message of messages) {
    if (message.role === 'user' && message.origin !== 'continue') {
      parts.push(message.text ?? '');
      if (runMatches()) {
        count += 1;
        parts = [];
      }
    } else if (message.role === 'agent' || message.role === 'summary') {
      parts = [];
    }
  }
  return count;
}

/**
 * A steer that arrived before any reply is one composer bubble
 * (`joinSteerPrompt`) but two stored user messages. It has landed when a new
 * run was stored after `seen` (the join count at send time).
 */
export function steerJoinLanded(
  text: string,
  messages: TranscriptMessage[],
  seen = 0,
): boolean {
  return countSteerJoins(text, messages) > seen;
}

/**
 * Joins of `items[index].text` already spent on earlier copies in this list.
 * A later resend stays pending while an earlier copy of the same joined text
 * is the one that landed.
 */
export function joinsClaimedBefore(
  items: ReadonlyArray<Pick<OptimisticUserSend, 'text' | 'seen' | 'seenJoins'>>,
  index: number,
  messages: TranscriptMessage[],
): number {
  const text = items[index]?.text ?? '';
  if (!text.includes('\n')) return 0;
  const total = countSteerJoins(text, messages);
  let claimed = 0;
  for (let i = 0; i < index; i++) {
    const prev = items[i];
    if (!prev || prev.text !== text) continue;
    const baseline = prev.seenJoins ?? prev.seen;
    if (total - claimed > baseline) claimed += 1;
  }
  return claimed;
}

/** Baselines for a composer bubble, captured when the user sends. */
export function userSendSeen(
  text: string,
  messages: TranscriptMessage[],
): { seen: number; seenJoins: number } {
  return {
    seen: matchingUserCount(messages, text),
    seenJoins: countSteerJoins(text, messages),
  };
}

export function unlandedUserTexts<T extends OptimisticUserSend>(
  optimistic: T[],
  messages: TranscriptMessage[],
): T[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'user' || message.origin === 'continue') continue;
    const text = message.text ?? '';
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const joinCounts = new Map<string, number>();
  const out: T[] = [];
  for (const item of optimistic) {
    let joins = joinCounts.get(item.text);
    if (joins == null) {
      joins = countSteerJoins(item.text, messages);
      joinCounts.set(item.text, joins);
    }
    const joinBaseline = item.seenJoins ?? item.seen;
    if (joins > joinBaseline) {
      joinCounts.set(item.text, joins - 1);
      continue;
    }
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
/** Turn finished without storing this bubble. Idle and queued still mean the send can land. */
const TURN_ENDED_STATUSES = new Set(['stopped', 'error', 'broken', 'archived']);

type PendingSnapshot = {
  messages: Array<{ role: string; text?: string; origin?: string }>;
  queue: string[];
  status: string;
};

/**
 * A thread refresh clones messages and the queue without changing them.
 * Reference inequality is not "the thread moved on" — that was dropping an
 * in-flight send while enqueue still held the lock.
 */
export function pendingSnapshotChanged(prev: PendingSnapshot, next: PendingSnapshot): boolean {
  if (prev.status !== next.status) return true;
  if (prev.queue.length !== next.queue.length) return true;
  for (let i = 0; i < prev.queue.length; i++) {
    if (prev.queue[i] !== next.queue[i]) return true;
  }
  if (prev.messages.length !== next.messages.length) return true;
  for (let i = 0; i < prev.messages.length; i++) {
    const before = prev.messages[i];
    const after = next.messages[i];
    if (
      before?.role !== after?.role ||
      before?.text !== after?.text ||
      before?.origin !== after?.origin
    ) {
      return true;
    }
  }
  return false;
}

function matchingUserCount(messages: TranscriptMessage[], text: string): number {
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
  messages: TranscriptMessage[];
  queue: string[];
  status: string;
  /** A later messages/queue/status snapshot than the one that showed this bubble. */
  threadMoved: boolean;
  seen?: number;
  /** Join-run count at send time. Falls back to `seen` when omitted. */
  seenJoins?: number;
  /** Joins of this text already attributed to earlier copies in the same list. */
  joinsClaimed?: number;
}): boolean {
  const matches = matchingUserCount(input.messages, input.text);
  const landed = input.seen == null ? matches > 0 : matches > input.seen;
  const joinBaseline = input.seenJoins ?? input.seen ?? 0;
  const claimed = input.joinsClaimed ?? 0;
  const joinsLeft = countSteerJoins(input.text, input.messages) - claimed;
  const joinLanded =
    input.seen == null && input.seenJoins == null
      ? joinsLeft > 0 && claimed === 0
      : joinsLeft > joinBaseline;
  if (landed || joinLanded) return true;
  if (!input.threadMoved) return false;
  if (input.status === 'running') return false;
  if (input.queue.includes(input.text)) {
    // Waiting to start: the transcript shows that prompt. Once the turn has
    // stopped, the queue dock owns it so it is not pinned under later replies.
    return !(input.status === 'queued' && input.queue[0] === input.text);
  }
  // Not in the transcript and not in the queue yet. Keep it through idle
  // and queued — the send may still be locking. Drop only after the turn
  // ends without saving this text.
  return TURN_ENDED_STATUSES.has(input.status);
}

/**
 * Transcript bubbles for sends that have not landed yet.
 * Composer sends are in `optimistic`. Plan answers, Implement plan, and Send
 * now only set `pendingUser`, so that text is included while it is in flight.
 */
export function pendingTranscriptTexts(input: {
  optimistic: OptimisticUserSend[];
  messages: TranscriptMessage[];
  currentTurnPrompt: string | null;
  pendingUser: string | null;
  pendingInTranscript: boolean;
}): string[] {
  const texts = unlandedUserTexts(input.optimistic, input.messages).map((item) => item.text);
  const landed = (text: string) => {
    const tracked = input.optimistic.find((item) => item.text === text);
    if (tracked) {
      const joins = countSteerJoins(text, input.messages);
      const exact = matchingUserCount(input.messages, text);
      return joins > (tracked.seenJoins ?? tracked.seen) || exact > tracked.seen;
    }
    return (
      input.messages.some((message) => message.role === 'user' && message.text === text) ||
      steerJoinLanded(text, input.messages)
    );
  };
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
 * Files for one pending transcript bubble. A queued follow-up owns its chips.
 * The in-flight steer snapshot is only for a bubble that is not a queued row.
 */
export function attachmentsOnPendingBubble(input: {
  text: string;
  isLast: boolean;
  pendingAttachments: ThreadAttachment[];
  followUps: PendingFollowUp[];
  queue: string[];
  queueAttachments?: ThreadAttachment[][];
}): ThreadAttachment[] {
  for (let i = input.followUps.length - 1; i >= 0; i--) {
    const item = input.followUps[i];
    if (item?.text === input.text) return item.attachments ?? [];
  }
  for (let i = input.queue.length - 1; i >= 0; i--) {
    if (input.queue[i] !== input.text) continue;
    return input.queueAttachments?.[i] ?? [];
  }
  return input.isLast ? input.pendingAttachments : [];
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
