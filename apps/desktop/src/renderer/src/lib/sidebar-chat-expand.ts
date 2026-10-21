/**
 * A workspace with two or more agents stays open so a second agent spawned
 * from orchestration is listed without opening that workspace. A single chat
 * stays on the parent row. A single orchestration agent nests only while
 * Orchestration is selected. The selected row can still collapse its list.
 */
export const SIDEBAR_NEST_MIN_CHATS = 2;

export function resolveSidebarChatExpanded(opts: {
  chatCount: number;
  selected: boolean;
  collapsedWhileSelected?: boolean;
  /** Default 2. Orchestration nests a single agent under the parent row. */
  minChats?: number;
}): boolean {
  const min = opts.minChats ?? SIDEBAR_NEST_MIN_CHATS;
  if (opts.chatCount < min) return false;
  if (opts.selected && opts.collapsedWhileSelected) return false;
  if (opts.chatCount >= SIDEBAR_NEST_MIN_CHATS) return true;
  return opts.selected;
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
