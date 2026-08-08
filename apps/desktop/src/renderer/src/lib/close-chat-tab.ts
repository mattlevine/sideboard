/** Short confirm copy when archiving / closing a chat tab. */
export function closeChatTabMessage(
  title: string,
  chatCount: number,
  opts?: { removesWorktree?: boolean },
): string {
  const label = title.trim() || 'Untitled';
  if (chatCount <= 1) {
    if (opts?.removesWorktree === false) {
      return `Close "${label}"? This chat will be moved to Settings → History.`;
    }
    return `Close "${label}"? This is the last tab — the worktree will be removed.`;
  }
  return `Close "${label}"? This chat will be moved to Settings → History.`;
}
