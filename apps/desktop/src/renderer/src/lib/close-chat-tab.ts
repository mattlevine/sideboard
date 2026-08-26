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

/** Confirm copy when archiving a whole checkout (Home Merged). */
export function archiveWorktreeMessage(
  title: string,
  chatCount: number,
  opts?: { removesWorktree?: boolean; cowboy?: boolean },
): string {
  const label = title.trim() || 'Untitled';
  const keepFolder = opts?.cowboy || opts?.removesWorktree === false;
  if (keepFolder) {
    if (chatCount > 1) {
      return `Archive "${label}"? All ${chatCount} chats will move to Settings → History. The project folder stays.`;
    }
    return `Archive "${label}"? This chat will move to Settings → History. The project folder stays.`;
  }
  if (chatCount > 1) {
    return `Archive "${label}"? All ${chatCount} chats on this worktree will move to Settings → History, and the worktree will be removed.`;
  }
  return `Archive "${label}"? This worktree will be removed. The chat moves to Settings → History.`;
}
