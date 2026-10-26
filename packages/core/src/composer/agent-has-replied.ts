import type { MessagePart, ThreadMessage } from '../types/thread.js';

/** Join a follow-up onto the prompt the agent has not answered yet. */
export function joinSteerPrompt(base: string, addition: string): string {
  const next = addition.trim();
  if (!next) return base;
  const head = base.replace(/\s+$/, '');
  if (!head) return next;
  return `${head}\n${next}`;
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
