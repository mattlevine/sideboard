import {
  isInternalAgentStatusText,
  lastAssistantMessageText,
} from '../agents/message-parts.js';
import { sumUsageList } from '../agents/usage.js';
import { latestVisibleMessageText, markdownPreviewSource } from '../board/home-board.js';
import type { Thread, ThreadMessage, TokenUsage } from '../types/thread.js';

/** Enough text for a board card / sidebar hover; not a full transcript. */
const LIST_PREVIEW_MAX = 480;

/**
 * Board, sidebar, and History only need a preview + billed totals + the last
 * agent timestamp. Shipping every tool dump over IPC parses and reconciles
 * those transcripts on the UI thread — archive/refresh storms then stall typing.
 *
 * Full messages stay on `readThread` / `getThread`.
 */
export function slimThreadForUiList(thread: Thread): Thread {
  const messages = thread.messages ?? [];
  return {
    ...thread,
    attachments: [],
    pendingTurnAttachments: [],
    messages: slimMessagesForUiList(messages, thread.updatedAt),
  };
}

export function slimMessagesForUiList(
  messages: ThreadMessage[],
  fallbackTs: string,
): ThreadMessage[] {
  if (messages.length === 0) return [];

  const usage = sumUsageList(messages.map((m) => m.usage));
  const lastAgent = lastAgentMessage(messages);
  const lastVisible = lastVisibleMessage(messages);
  const preview = markdownPreviewSource(latestVisibleMessageText(messages), LIST_PREVIEW_MAX);

  if (lastVisible && lastAgent && lastVisible !== lastAgent) {
    return [
      agentStub(lastAgent, '', usage),
      { role: lastVisible.role, text: preview, ts: lastVisible.ts },
    ];
  }
  if (lastVisible) {
    return [
      lastVisible.role === 'agent'
        ? agentStub(lastVisible, preview, usage)
        : { role: lastVisible.role, text: preview, ts: lastVisible.ts, ...(usage ? { usage } : {}) },
    ];
  }
  if (lastAgent) {
    return [agentStub(lastAgent, '', usage)];
  }
  return [
    {
      role: 'summary',
      text: '',
      ts: messages[messages.length - 1]?.ts ?? fallbackTs,
      ...(usage ? { usage } : {}),
    },
  ];
}

function lastAgentMessage(messages: ThreadMessage[]): ThreadMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'agent') return m;
  }
  return undefined;
}

function lastVisibleMessage(messages: ThreadMessage[]): ThreadMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === 'agent') {
      const text = (lastAssistantMessageText(m.parts) || m.text || '').trim();
      if (text && !isInternalAgentStatusText(text)) return m;
      continue;
    }
    if (m.role === 'user' && m.text?.trim()) return m;
  }
  return undefined;
}

function agentStub(
  source: ThreadMessage,
  text: string,
  usage: TokenUsage | null,
): ThreadMessage {
  return {
    role: 'agent',
    text,
    ts: source.ts,
    ...(usage ? { usage } : {}),
  };
}
