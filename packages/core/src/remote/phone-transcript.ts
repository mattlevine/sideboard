import type { Thread } from '../types/thread.js';
import { readTurnLiveParts } from '../store/turn-live.js';
import { phoneArtifactText } from './phone-artifact.js';
import { phoneStreamFrame } from './phone-stream.js';

export interface PhoneTranscriptMessage {
  role: 'user' | 'agent';
  text: string;
  streaming?: boolean;
}

const PHONE_USER_PREFIX = 'Phone\n\n';
const TRANSCRIPT_LIMIT = 40;
const MESSAGE_LIMIT = 4_000;

export function phoneVisibleText(role: 'user' | 'agent', text: string): string {
  const trimmed = text.trim();
  if (role === 'user' && trimmed.startsWith(PHONE_USER_PREFIX)) {
    return trimmed.slice(PHONE_USER_PREFIX.length).trim();
  }
  return trimmed;
}

export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

/**
 * Persisted bubbles, plus the in-progress answer when a turn is still running.
 * That tail is not on the thread until the turn finishes, so a phone that
 * opens the chat mid-turn would otherwise stop at the last completed message.
 */
function withLiveTail(thread: Thread, messages: PhoneTranscriptMessage[]): PhoneTranscriptMessage[] {
  if (thread.status !== 'running' && thread.status !== 'queued') return messages;
  const text = clip(phoneStreamFrame(readTurnLiveParts(thread.id)).text.trim(), MESSAGE_LIMIT);
  if (!text) return messages;
  const last = messages[messages.length - 1];
  if (last?.role === 'agent' && last.text === text) {
    return last.streaming ? messages : [...messages.slice(0, -1), { ...last, streaming: true }];
  }
  return [...messages, { role: 'agent', text, streaming: true }];
}

export function listPhoneMessages(thread: Thread): PhoneTranscriptMessage[] {
  const out: PhoneTranscriptMessage[] = [];
  for (const message of thread.messages) {
    if (message.role !== 'user' && message.role !== 'agent') continue;
    const names = (message.attachments ?? []).map((item) => item.name.trim()).filter(Boolean);
    const visible = [phoneVisibleText(message.role, message.text), names.length ? names.join(', ') : '']
      .filter(Boolean)
      .join('\n');
    const text =
      message.role === 'agent' ? phoneArtifactText(visible, message.parts, MESSAGE_LIMIT) : clip(visible, MESSAGE_LIMIT);
    if (!text) continue;
    out.push({ role: message.role, text });
  }
  const live = withLiveTail(thread, out);
  for (const prompt of thread.queue) {
    const text = clip(phoneVisibleText('user', prompt), MESSAGE_LIMIT);
    if (text) live.push({ role: 'user', text });
  }
  return live.slice(-TRANSCRIPT_LIMIT);
}
