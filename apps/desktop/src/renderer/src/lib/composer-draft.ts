/**
 * Per-chat composer text for the desktop session.
 * ThreadPanel unmounts when you leave a chat (Home, another tab, create overlay),
 * so drafts must live outside React state.
 */
const draftsByThread = new Map<string, string>();

export function getComposerDraft(threadId: string): string {
  return draftsByThread.get(threadId) ?? '';
}

export function rememberComposerDraft(threadId: string, text: string): void {
  if (!text) {
    draftsByThread.delete(threadId);
    return;
  }
  draftsByThread.set(threadId, text);
}

export function clearComposerDraft(threadId: string): void {
  draftsByThread.delete(threadId);
}
