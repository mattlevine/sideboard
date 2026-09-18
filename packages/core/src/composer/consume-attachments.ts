import type { ThreadAttachment } from '../types/thread.js';

/**
 * Move composer staging off the chip tray. Send must do this immediately —
 * waiting until `runTurn` leaves the image chip in the box (and a refresh
 * between appendMessage and the old clear can put it back).
 */
export function consumeComposerAttachments(thread: {
  attachments: ThreadAttachment[];
}): {
  attachments: ThreadAttachment[];
  consumed: ThreadAttachment[];
} {
  return {
    attachments: [],
    consumed: [...thread.attachments],
  };
}

/**
 * Attachments the next non-continue turn should send, then drop.
 * A parked send snapshot wins. Leftover composer files arrived after send
 * and belong to the next message — do not steal them.
 */
export function takePendingTurnAttachments(thread: {
  attachments: ThreadAttachment[];
  pendingTurnAttachments?: ThreadAttachment[];
}): ThreadAttachment[] {
  const pending = thread.pendingTurnAttachments ?? [];
  if (pending.length > 0) return [...pending];
  return thread.attachments.length > 0 ? [...thread.attachments] : [];
}

/** Keep `queueAttachments` the same length as `queue`. Missing slots are empty. */
export function alignQueueAttachments(
  queueLength: number,
  existing?: ThreadAttachment[][],
): ThreadAttachment[][] {
  const next = (existing ?? []).slice(0, queueLength).map((slot) => [...(slot ?? [])]);
  while (next.length < queueLength) next.push([]);
  return next;
}

export function appendQueuedItem(
  queue: string[],
  queueAttachments: ThreadAttachment[][] | undefined,
  prompt: string,
  attachments: ThreadAttachment[] = [],
): { queue: string[]; queueAttachments: ThreadAttachment[][] } {
  return {
    queue: [...queue, prompt],
    queueAttachments: [...alignQueueAttachments(queue.length, queueAttachments), [...attachments]],
  };
}

export function prependQueuedItem(
  queue: string[],
  queueAttachments: ThreadAttachment[][] | undefined,
  prompt: string,
  attachments: ThreadAttachment[] = [],
): { queue: string[]; queueAttachments: ThreadAttachment[][] } {
  return {
    queue: [prompt, ...queue],
    queueAttachments: [[...attachments], ...alignQueueAttachments(queue.length, queueAttachments)],
  };
}

export function removeQueuedItem(
  queue: string[],
  queueAttachments: ThreadAttachment[][] | undefined,
  index: number,
): { queue: string[]; queueAttachments: ThreadAttachment[][] } {
  const aligned = alignQueueAttachments(queue.length, queueAttachments);
  return {
    queue: queue.filter((_, i) => i !== index),
    queueAttachments: aligned.filter((_, i) => i !== index),
  };
}

export function moveQueuedItemToFront(
  queue: string[],
  queueAttachments: ThreadAttachment[][] | undefined,
  index: number,
): { queue: string[]; queueAttachments: ThreadAttachment[][] } {
  const aligned = alignQueueAttachments(queue.length, queueAttachments);
  return {
    queue: [queue[index]!, ...queue.filter((_, i) => i !== index)],
    queueAttachments: [aligned[index] ?? [], ...aligned.filter((_, i) => i !== index)],
  };
}

export function shiftQueuedItem(
  queue: string[],
  queueAttachments: ThreadAttachment[][] | undefined,
): {
  prompt: string;
  attachments: ThreadAttachment[];
  queue: string[];
  queueAttachments: ThreadAttachment[][];
} | null {
  if (queue.length === 0) return null;
  const aligned = alignQueueAttachments(queue.length, queueAttachments);
  return {
    prompt: queue[0]!,
    attachments: aligned[0] ?? [],
    queue: queue.slice(1),
    queueAttachments: aligned.slice(1),
  };
}
