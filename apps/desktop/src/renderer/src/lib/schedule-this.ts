import type { Autonomy, Thread, ThinkingEffort } from '@sideboard-ai/core';
import { isOrchestratorThread } from './global-workspace';

/** Suggested interval when promoting a finished prompt. */
export const SCHEDULE_THIS_EVERY = '1d';

export interface ScheduleThisPrefill {
  prompt: string;
  /** Empty starts a new Global chat on each fire. */
  threadId: string;
  every: string;
  /** Clock time kept on the form if they switch from interval to weekly. */
  time: string;
  agent: string | null;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  planMode: boolean;
  autonomy: Autonomy;
}

/** Selected transcript text, or the latest user prompt. */
export function scheduleThisPrompt(input: {
  selectedText?: string | null;
  messages: Array<{ role: string; text?: string }>;
}): string | null {
  const selected = input.selectedText?.trim() ?? '';
  if (selected) return selected;
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (message?.role === 'user' && message.text?.trim()) return message.text.trim();
  }
  return null;
}

/**
 * A Global or orchestration chat becomes a new Global automation.
 * Any other chat continues that chat.
 */
export function scheduleThisThreadId(
  thread: Pick<Thread, 'id' | 'sourceType' | 'repoPath'>,
): string {
  return isOrchestratorThread(thread) ? '' : thread.id;
}

/** Next half-hour on the local clock, so a weekly time is still ahead. */
export function suggestedScheduleTime(now = new Date()): string {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const slot = Math.ceil((minutes + 1) / 30) * 30;
  const wrapped = slot % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Selection inside the transcript. Text outside the chat is ignored. */
export function transcriptSelectionText(root: HTMLElement | null): string {
  if (!root || typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return '';
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return '';
  const node = selection.anchorNode;
  if (!node || !root.contains(node)) return '';
  return selection.toString().trim();
}
