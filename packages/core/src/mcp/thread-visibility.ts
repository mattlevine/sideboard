import { isInternalAgentStatusText } from '../agents/message-parts.js';
import type { Thread, ThreadMessage } from '../types/thread.js';

/** Last non-empty message text for coordinators (not the full transcript). */
export function lastMessagePreview(
  messages: ThreadMessage[] | undefined,
  max = 160,
): string | null {
  if (!messages?.length) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i]?.text?.trim();
    if (!text || isInternalAgentStatusText(text)) continue;
    const flat = text.replace(/\s+/g, ' ');
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
  }
  return null;
}

export function childThreadRefs(
  parentId: string,
  threads: Array<Pick<Thread, 'id' | 'title' | 'status' | 'agent' | 'parentThreadId' | 'messages'>>,
): Array<{
  id: string;
  title: string;
  status: Thread['status'];
  agent: Thread['agent'];
  lastText: string | null;
}> {
  return threads
    .filter((t) => t.parentThreadId === parentId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      agent: t.agent,
      lastText: lastMessagePreview(t.messages, 120),
    }));
}
