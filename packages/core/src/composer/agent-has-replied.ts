import { mergeTurnAttachments } from './consume-attachments.js';
import type { MessagePart, ThreadAttachment, ThreadMessage } from '../types/thread.js';

/** Join a follow-up onto the prompt the agent has not answered yet. */
export function joinSteerPrompt(base: string, addition: string): string {
  const next = addition.trim();
  if (!next) return base;
  const head = base.replace(/\s+$/, '');
  if (!head) return next;
  return `${head}\n${next}`;
}

/**
 * Steer joins onto the user prompt above a partial reply. Skip agent rows
 * and stop at the first real user message so an older prompt is left alone.
 */
export function messagesWithRewrittenUserPrompt(
  messages: ThreadMessage[],
  from: string,
  to: string,
  attachments?: ThreadAttachment[],
): ThreadMessage[] | null {
  const extra = attachments ?? [];
  if (from === to && extra.length === 0) return null;
  const next = messages.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    const message = next[i];
    if (!message || message.origin === 'continue' || message.role === 'summary') continue;
    if (message.role !== 'user') continue;
    if (message.text !== from) return null;
    const merged = mergeTurnAttachments(message.attachments, extra);
    if (from === to && merged.length === (message.attachments?.length ?? 0)) return null;
    next[i] = {
      ...message,
      text: to,
      ...(merged.length > 0 ? { attachments: merged } : {}),
    };
    return next;
  }
  return null;
}

/**
 * True when `promptText` is already on screen: the latest unanswered user
 * message, or the separate user messages that were joined into that prompt.
 * A later agent reply with text or parts ends the run. A partial reply that
 * only sits under those user messages does not hide them.
 */
export function userMessagesCoverPrompt(messages: ThreadMessage[], promptText: string): boolean {
  if (!promptText) return false;
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.origin === 'continue' || message.role === 'summary') continue;
    if (message.role === 'agent') {
      const text = (message.text ?? '').trim();
      const hasContent = Boolean(text) || (message.parts?.length ?? 0) > 0;
      if (hasContent && parts.length > 0) break;
      continue;
    }
    if (message.role !== 'user') continue;
    const text = message.text ?? '';
    if (text === promptText) return true;
    parts.unshift(text);
    let acc = parts[0] ?? '';
    for (let j = 1; j < parts.length; j++) acc = joinSteerPrompt(acc, parts[j] ?? '');
    if (acc === promptText) return true;
    if (acc.length > promptText.length) return false;
  }
  return false;
}

/** Latest user prompt when no agent reply has been stored after it. */
export function trailingUnansweredUserText(messages: ThreadMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.origin === 'continue' || message.role === 'summary') continue;
    if (message.role === 'agent') {
      const text = (message.text ?? '').trim();
      if (text || (message.parts?.length ?? 0) > 0) return null;
      continue;
    }
    if (message.role === 'user') return message.text;
  }
  return null;
}

/** Live turn output the user can already see: text, thinking, or a tool call. */
export function livePartsShowAgentReply(parts: MessagePart[]): boolean {
  for (const part of parts) {
    if (part.type === 'tool') return true;
    if ((part.type === 'text' || part.type === 'thinking') && part.text.trim()) return true;
  }
  return false;
}
