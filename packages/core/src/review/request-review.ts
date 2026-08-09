import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Thread, ThreadAttachment } from '../types/thread.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { createChatTab } from '../threads/chat-tabs.js';
import { findThreadByRef } from '../store/thread-store.js';

/** Worktree-relative path for the editable review prompt (Conductor-style). */
export const REVIEW_REQUEST_PATH = '.sideboard/attachments/Review request.md';

export const REVIEW_REQUEST_NAME = 'Review request.md';

export const REVIEW_REQUEST_PREFILL = `Please review the changes in this workspace and recommend whether they are ready to merge.

Start with a **Recommendation**: Approve, Approve with nits, Request changes, or Needs more information — and say why in 1–3 sentences. Then list blocking findings vs nits (findings may be empty).`;

export function buildReviewRequestAttachment(content: string): ThreadAttachment {
  return {
    id: randomUUID(),
    name: REVIEW_REQUEST_NAME,
    kind: 'file',
    path: REVIEW_REQUEST_PATH,
    content,
  };
}

/**
 * Read an existing custom Review request.md from the worktree if present.
 * Does not create the file (matches desktop Review button behavior).
 */
export function readExistingReviewRequestFile(worktreePath: string): string | null {
  const abs = join(worktreePath, REVIEW_REQUEST_PATH);
  if (!existsSync(abs)) return null;
  try {
    const content = readFileSync(abs, 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

export interface RequestReviewResult {
  /** New Review chat tab. */
  tab: Thread;
  /** Worktree thread that was reviewed (source of the tab). */
  from: Thread;
}

type SendFn = (threadRef: string, prompt: string) => Promise<Thread>;

/**
 * Mirror the desktop sidebar Review action: open a fresh "Review" chat tab on
 * the same worktree and send the merge-readiness prefill (attach custom
 * guidelines file when present).
 */
export async function requestReview(
  threadRef: string,
  send: SendFn,
): Promise<RequestReviewResult> {
  const from = findThreadByRef(threadRef);
  if (!from) throw new Error(`Thread not found: ${threadRef}`);
  if (isOrchestratorThread(from)) {
    throw new Error(
      'request_review targets a worktree agent thread (not the orchestrator). Pass a child/worktree thread ref.',
    );
  }
  if (from.status === 'archived') {
    throw new Error(`Thread is archived: ${from.id}`);
  }

  const existing = readExistingReviewRequestFile(from.worktreePath);
  const attachments = existing ? [buildReviewRequestAttachment(existing)] : [];
  const tab = createChatTab({
    fromThreadId: from.id,
    title: 'Review',
    attachments,
  });
  const started = await send(tab.id, REVIEW_REQUEST_PREFILL);
  return { tab: started, from };
}
