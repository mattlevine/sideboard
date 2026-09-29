import type { ChatTextScale } from '@sideboard-ai/core';

/** Runtime guard — keep out of `@sideboard-ai/core` barrel imports in the renderer. */
export function isChatTextScale(value: unknown): value is ChatTextScale {
  return value === 1.2 || value === 1.4;
}

export function resolveChatTextScale(value: unknown): ChatTextScale {
  return isChatTextScale(value) ? value : 1.2;
}

/** Labels for Settings → Advanced → Chat text size. */
export const CHAT_TEXT_SCALE_OPTIONS: ReadonlyArray<{
  value: ChatTextScale;
  label: string;
}> = [
  { value: 1.2, label: '1.2× left nav (default)' },
  { value: 1.4, label: '1.4× left nav' },
];

/** Drives `--font-size-chat` via `--chat-text-scale` in global.css. */
export function applyChatTextScale(scale: ChatTextScale): void {
  document.documentElement.style.setProperty('--chat-text-scale', String(scale));
}
