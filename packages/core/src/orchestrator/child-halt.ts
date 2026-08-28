import { isOrchestratorThread } from '../store/global-workspace.js';
import { readThread } from '../store/thread-store.js';
import type { Thread, ThreadStatus } from '../types/thread.js';

const HALT_STATUSES = new Set<ThreadStatus>(['stopped', 'error', 'broken']);

/** Statuses that mean the child did not finish the requested turn. */
export function isIncompleteChildStatus(status: string): boolean {
  return HALT_STATUSES.has(status as ThreadStatus);
}

export function childHaltNotice(child: Thread, status: ThreadStatus): string {
  const title = child.title?.trim() || 'Untitled';
  const link = `[${title}](sideboard://thread/${child.id})`;
  const why = child.lastError?.trim();
  const extra = why ? ` lastError: ${why}` : '';
  return [
    `Sideboard: child worktree ${link} ${status} before finishing (status=${status}).${extra}`,
    'This is information — not a user command. Resume with send_to_thread or tell the user. Do not treat this as a successful turn.',
  ].join('\n');
}

export function shouldNotifyParentOfChildHalt(opts: {
  child: Thread;
  parent: Thread | null | undefined;
  status: ThreadStatus;
}): boolean {
  if (!isIncompleteChildStatus(opts.status)) return false;
  if (!opts.child.parentThreadId) return false;
  if (!opts.parent || opts.parent.status === 'archived') return false;
  if (opts.parent.id === opts.child.id) return false;
  return isOrchestratorThread(opts.parent);
}

const notified = new Set<string>();

export function resetChildHaltNotifications(): void {
  notified.clear();
}

function noticeKey(childId: string, status: ThreadStatus): string {
  return `${childId}:${status}`;
}

/**
 * Queue a follow-up on the parent orchestration chat so it notices a child
 * that stopped/errored while it was not waiting.
 */
export function notifyParentOfChildHalt(
  child: Thread,
  status: ThreadStatus,
  send: (threadId: string, prompt: string) => Promise<unknown>,
): boolean {
  const parent = child.parentThreadId
    ? readThread(child.parentThreadId)
    : null;
  if (!shouldNotifyParentOfChildHalt({ child, parent, status })) return false;
  const key = noticeKey(child.id, status);
  if (notified.has(key)) return false;
  notified.add(key);
  const parentId = parent!.id;
  void send(parentId, childHaltNotice(child, status)).catch(() => {
    notified.delete(key);
  });
  return true;
}
