import { readThread, updateThread } from '../store/thread-store.js';

/** Last `ui/update-model-context` text. Prepended on the next turn, then cleared. */
export function stashMcpAppModelContext(threadId: string, text: string): void {
  const body = text.trim().slice(0, 8_000);
  if (!body) return;
  updateThread(threadId, { mcpAppModelContext: body });
}

export function takeMcpAppModelContext(threadId: string): string | undefined {
  const thread = readThread(threadId);
  const text = thread?.mcpAppModelContext?.trim();
  if (!text) return undefined;
  updateThread(threadId, { mcpAppModelContext: null });
  return text;
}
