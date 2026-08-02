/** Short confirm copy when archiving / closing a chat tab. */
export function closeChatTabMessage(title: string, chatCount: number): string {
  const label = title.trim() || 'Untitled';
  if (chatCount <= 1) {
    return `Close "${label}"? This is the last tab — the worktree will be removed.`;
  }
  return `Close "${label}"? This chat will be moved to History.`;
}
