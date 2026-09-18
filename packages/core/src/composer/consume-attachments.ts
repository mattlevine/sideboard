import type { ThreadAttachment } from '../types/thread.js';

/**
 * Move composer staging onto the next user turn and empty the composer.
 * Send must do this immediately — waiting until `runTurn` leaves the image
 * chip in the box (and a refresh between appendMessage and the old clear
 * can put it back).
 */
export function consumeComposerAttachments(thread: {
  attachments: ThreadAttachment[];
  pendingTurnAttachments?: ThreadAttachment[];
}): {
  attachments: ThreadAttachment[];
  pendingTurnAttachments: ThreadAttachment[];
} {
  if (thread.attachments.length === 0) {
    return {
      attachments: [],
      pendingTurnAttachments: thread.pendingTurnAttachments ?? [],
    };
  }
  return {
    attachments: [],
    pendingTurnAttachments: [
      ...(thread.pendingTurnAttachments ?? []),
      ...thread.attachments,
    ],
  };
}

/** Attachments the next non-continue turn should send, then drop. */
export function takePendingTurnAttachments(thread: {
  attachments: ThreadAttachment[];
  pendingTurnAttachments?: ThreadAttachment[];
}): ThreadAttachment[] {
  const pending = thread.pendingTurnAttachments ?? [];
  if (pending.length === 0 && thread.attachments.length === 0) return [];
  return [...pending, ...thread.attachments];
}
