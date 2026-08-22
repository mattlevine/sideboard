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
