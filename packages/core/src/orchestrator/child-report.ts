import { orchestratorPromisedLaterReport } from '../mcp/wait-for-job.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { readThread } from '../store/thread-store.js';
import { lastAgentReply } from '../threads/injected-notices.js';
import type { Thread } from '../types/thread.js';

/** One wake per promised farewell, and a cap so a looping farewell cannot spin. */
const MAX_REPORT_WAKES = 2;

const sentForReply = new Set<string>();
const wakesByParent = new Map<string, number>();

export function resetParentReportWakes(): void {
  sentForReply.clear();
  wakesByParent.clear();
}

export function clearParentReportWake(parentId: string): void {
  wakesByParent.delete(parentId);
  const prefix = `${parentId}:`;
  for (const key of sentForReply) {
    if (key.startsWith(prefix)) sentForReply.delete(key);
  }
}

/**
 * Parent went idle after promising a later update, and a child just finished.
 * Successful child turns do not otherwise wake the orchestrator, so Slack
 * (and the desktop) never get the outcome.
 */
export function parentOwesDeferredReport(parent: Thread | null | undefined): boolean {
  if (!parent || parent.status === 'archived') return false;
  if (!isOrchestratorThread(parent)) return false;
  if (parent.status !== 'idle') return false;
  if (parent.queue.length > 0) return false;
  const last = lastAgentReply(parent.messages);
  return orchestratorPromisedLaterReport(last?.text);
}

export function childFinishedReportPrompt(child: Thread): string {
  const title = child.title?.trim() || 'Untitled';
  const link = `[${title}](sideboard://chat/${child.id})`;
  return [
    `Sideboard: child worktree ${link} finished (status=idle).`,
    'You told the user you would report later. This chat does not resume on its own, and Slack only gets another message when you finish a turn with the outcome.',
    'Read get_turn_result for this child and any siblings. If any are still running (stillRunning true), loop wait_for_turn until they finish.',
    'Then reply with the outcome. Do not promise a later update.',
    'This is information — not a new user request.',
  ].join('\n');
}

function replyKey(parent: Thread): string | null {
  const last = lastAgentReply(parent.messages);
  if (!last) return null;
  return `${parent.id}:${last.ts}`;
}

/**
 * Wake an idle orchestrator that promised to report later. No-op while that
 * chat is running or already has a queued continue — the in-flight turn
 * should read the result itself.
 */
export function notifyParentOfChildReport(
  child: Thread,
  send: (threadId: string, prompt: string) => Promise<unknown>,
): boolean {
  if (!child.parentThreadId) return false;
  const parent = readThread(child.parentThreadId);
  if (!parentOwesDeferredReport(parent)) return false;
  const key = replyKey(parent!);
  if (!key || sentForReply.has(key)) return false;
  const wakes = wakesByParent.get(parent!.id) ?? 0;
  if (wakes >= MAX_REPORT_WAKES) return false;
  sentForReply.add(key);
  wakesByParent.set(parent!.id, wakes + 1);
  const parentId = parent!.id;
  void send(parentId, childFinishedReportPrompt(child)).catch(() => {
    sentForReply.delete(key);
    const current = wakesByParent.get(parentId) ?? 1;
    if (current <= 1) wakesByParent.delete(parentId);
    else wakesByParent.set(parentId, current - 1);
  });
  return true;
}
