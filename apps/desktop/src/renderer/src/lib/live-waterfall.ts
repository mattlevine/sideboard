import type { Thread } from '@sideboard-ai/core';
import {
  coerceOrderBoard,
  formatWaterfallHtml,
  orderSnapshotFromThread,
  type OrderBoard,
  type OrderPlanBoard,
} from '@sideboard/order-view';
import { GLOBAL_WORKSPACE_ID } from './global-workspace';

function isOrchestration(thread: Thread): boolean {
  return thread.sourceType === 'orchestration' || thread.repoPath === GLOBAL_WORKSPACE_ID;
}

/** Plan this chat should keep open: its own, or its orchestrator parent's. */
async function planForChat(board: OrderBoard, threadId: string | undefined): Promise<OrderPlanBoard | null> {
  if (board.plans.length === 0) return null;
  if (!threadId) return board.plans.length === 1 ? board.plans[0]! : null;
  let current = await window.sideboard.getThread(threadId);
  const seen = new Set<string>();
  for (let hop = 0; hop < 6 && current && !seen.has(current.id); hop++) {
    seen.add(current.id);
    const owned = board.plans.find((item) => item.plan.ownerThreadId === current!.id);
    if (owned) return owned;
    if (isOrchestration(current)) break;
    const parentId = current.parentThreadId?.trim();
    if (!parentId) break;
    current = await window.sideboard.getThread(parentId);
  }
  return board.plans.length === 1 ? board.plans[0]! : null;
}

/**
 * Fresh planner HTML. Gates and the Working mark come from the live board,
 * so the side column can replace the snapshot `show_waterfall` first returned.
 */
export async function refreshLiveWaterfall(threadId: string | undefined): Promise<string | null> {
  const board = coerceOrderBoard(await window.sideboard.listOrder());
  const item = await planForChat(board, threadId);
  if (!item) {
    return board.plans.length === 0 ? formatWaterfallHtml([]) : null;
  }
  const thread = threadId ? await window.sideboard.getThread(threadId) : null;
  return formatWaterfallHtml(item.chains, {
    plan: item.plan,
    you: thread ? orderSnapshotFromThread(thread) : null,
  });
}
