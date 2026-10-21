import type { AgentBlock } from '../types/agent-block.js';
import type { Thread } from '../types/thread.js';

/** Activity dot for a worktree: running / queued beat idle sibling tabs. */
export function worktreeBoardStatus(group: Array<Pick<Thread, 'status'>>): Thread['status'] {
  const order: Thread['status'][] = ['running', 'queued', 'error', 'broken'];
  for (const status of order) {
    if (group.some((t) => t.status === status)) return status;
  }
  return group[0]?.status ?? 'idle';
}

/**
 * True when this ask_user highlight belongs to a question the user already
 * skipped in that chat. A block with no signature is the same generation
 * (stamped before signatures existed, or a notify with no question set).
 */
export function isDismissedAskUserBlock(
  block: AgentBlock | null | undefined,
  dismissedQuestionSignature: string | null | undefined,
): boolean {
  if (!block || block.source !== 'ask_user') return false;
  const dismissed = dismissedQuestionSignature?.trim();
  if (!dismissed) return false;
  if (!block.questionSignature) return true;
  return block.questionSignature === dismissed;
}

/** Blocked highlight. Errors and archived chats keep their own status. */
export function visibleAgentBlock(
  thread: Pick<Thread, 'status' | 'agentBlock' | 'dismissedQuestionSignature'>,
): AgentBlock | null {
  if (
    thread.status === 'archived' ||
    thread.status === 'error' ||
    thread.status === 'broken'
  ) {
    return null;
  }
  const block = thread.agentBlock;
  if (!block?.reason?.trim()) return null;
  if (isDismissedAskUserBlock(block, thread.dismissedQuestionSignature)) return null;
  return block;
}

/**
 * Worktree rollup. A blocked agent outranks a working sibling — same priority
 * Herdr uses so the row that needs a decision is the one you see.
 */
export function worktreeAgentBlock(
  group: Array<Pick<Thread, 'status' | 'agentBlock' | 'dismissedQuestionSignature'>>,
): AgentBlock | null {
  let best: AgentBlock | null = null;
  for (const thread of group) {
    const block = visibleAgentBlock(thread);
    if (!block) continue;
    if (!best || block.at > best.at) best = block;
  }
  return best;
}

/**
 * Reason on the worktree parent row. While one of its chats is open, the
 * row matches that chat — a sibling's question must not sit in the sidebar
 * after you have switched agents. Closed rows still roll up the group.
 */
export function sidebarRowAgentBlock(
  group: Array<Pick<Thread, 'id' | 'status' | 'agentBlock' | 'dismissedQuestionSignature'>>,
  opts: { active: boolean; selectedId: string | null },
): AgentBlock | null {
  if (opts.active) {
    const open = group.find((thread) => thread.id === opts.selectedId);
    if (open) return visibleAgentBlock(open);
  }
  return worktreeAgentBlock(group);
}

/**
 * Thread to open when a worktree row is showing a question highlight.
 * The parent row rolls up any sibling; the click should land on the chat
 * that actually asked, which is where the picker renders.
 */
export function sidebarQuestionThreadId(
  group: Array<Pick<Thread, 'id' | 'status' | 'agentBlock' | 'dismissedQuestionSignature'>>,
  primaryId: string,
): string {
  const block = worktreeAgentBlock(group);
  if (!block) return primaryId;
  const owner = group.find((thread) => visibleAgentBlock(thread) === block);
  return owner?.id ?? primaryId;
}

export function threadCardBlockFields(
  group: Array<Pick<Thread, 'status' | 'agentBlock' | 'dismissedQuestionSignature'>>,
): { blockedReason: string; blockedSource: AgentBlock['source'] } | null {
  const block = worktreeAgentBlock(group);
  return block ? { blockedReason: block.reason, blockedSource: block.source } : null;
}
