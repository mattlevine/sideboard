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

export type PendingFollowUp = { id: string; text: string };

/**
 * Optimistic follow-ups that have not landed in `thread.queue` yet.
 * Consumes matching persisted texts so the same prompt is not shown twice.
 */
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
