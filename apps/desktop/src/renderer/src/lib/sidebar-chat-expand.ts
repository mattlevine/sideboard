/** Nested chats open only while this worktree is selected and has more than one. */
export const SIDEBAR_NEST_MIN_CHATS = 2;

/** Visible nested agent rows before the list scrolls. */
export const SIDEBAR_NEST_VISIBLE_ROWS = 3;

export function resolveSidebarChatExpanded(opts: {
  chatCount: number;
  selected: boolean;
  collapsedWhileSelected?: boolean;
}): boolean {
  if (opts.chatCount < SIDEBAR_NEST_MIN_CHATS || !opts.selected) return false;
  return !opts.collapsedWhileSelected;
}

/**
 * Always-on second line, same rhythm as the previous sidebar:
 * branch (when the title is a PR) · agent · N agents · :port
 */
export function worktreeSidebarMeta(opts: {
  agent: string;
  chatCount: number;
  branch?: string | null;
  port?: number | null;
  archiving?: boolean;
}): string {
  if (opts.archiving) return 'Archiving…';
  const parts: string[] = [];
  const branch = opts.branch?.trim() ?? '';
  const agent = opts.agent.trim();
  if (branch) parts.push(branch);
  if (agent) parts.push(agent);
  if (opts.chatCount >= SIDEBAR_NEST_MIN_CHATS) {
    parts.push(`${opts.chatCount} agents`);
  }
  if (opts.port != null && opts.port > 0) parts.push(`:${opts.port}`);
  return parts.join(' · ');
}
