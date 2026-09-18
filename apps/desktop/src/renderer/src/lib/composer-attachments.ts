import type { ThreadAttachment, ThreadMessage } from '@sideboard-ai/core';

/** Hide chips already handed to a pending or sent user turn. */
export function visibleComposerAttachments(
  staged: ThreadAttachment[],
  opts?: {
    pending?: ThreadAttachment[];
    messages?: Pick<ThreadMessage, 'attachments'>[];
  },
): ThreadAttachment[] {
  if (staged.length === 0) return staged;
  const sent = new Set<string>();
  for (const a of opts?.pending ?? []) sent.add(a.id);
  for (const m of opts?.messages ?? []) {
    for (const a of m.attachments ?? []) sent.add(a.id);
  }
  if (sent.size === 0) return staged;
  return staged.filter((a) => !sent.has(a.id));
}
