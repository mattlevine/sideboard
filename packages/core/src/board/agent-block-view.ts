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

export function threadCardBlockFields(
  group: Array<Pick<Thread, 'status' | 'agentBlock' | 'dismissedQuestionSignature'>>,
): { blockedReason: string; blockedSource: AgentBlock['source'] } | null {
  const block = worktreeAgentBlock(group);
  return block ? { blockedReason: block.reason, blockedSource: block.source } : null;
}
