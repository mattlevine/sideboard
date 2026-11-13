import { isGlobalThread } from '../store/global-workspace.js';
import { wakeOrchestratorOnGithubEdgesEnabled } from '../store/app-settings.js';
import { findThreadByRef, updateThread } from '../store/thread-store.js';
import type { Thread } from '../types/thread.js';
import { normalizeWorktreePath } from '../git/worktree-labels.js';
import { threadsSharingWorktree } from './chat-tabs.js';

type WakeTarget = Pick<Thread, 'id' | 'worktreePath' | 'sourceType' | 'repoPath'>;

/**
 * Which chat a wake opt-in applies to. Worktree agents may only change their
 * own checkout. Orchestrators pass any project-workspace chat id.
 */
export function wakeOnGithubEdgesTargetRef(opts: {
  ownWorktreeOnly: boolean;
  caller: WakeTarget | null;
  requestedRef?: string | null;
  find: (ref: string) => WakeTarget | null;
}): string {
  const requested = opts.requestedRef?.trim() || '';
  if (!opts.ownWorktreeOnly) {
    if (!requested) throw new Error('Pass a chat id on the workspace.');
    return requested;
  }
  const caller = opts.caller;
  if (!caller || isGlobalThread(caller) || caller.sourceType === 'orchestration') {
    throw new Error('CI and review wakes belong on a project workspace. This chat is not one.');
  }
  if (!requested || requested === caller.id) return caller.id;
  const other = opts.find(requested);
  if (
    !other ||
    normalizeWorktreePath(other.worktreePath) !== normalizeWorktreePath(caller.worktreePath)
  ) {
    throw new Error('You can only change this switch on this workspace.');
  }
  return other.id;
}

/**
 * Shared by every live chat on the checkout. Refuses when the Advanced
 * master switch is off — agents cannot turn that on.
 */
export function applyWakeOnGithubEdges(threadRef: string, enabled: boolean): Thread {
  if (!wakeOrchestratorOnGithubEdgesEnabled()) {
    throw new Error(
      'Settings → Advanced → Wake orchestrator on CI / review-requested is off. Turn that on in Settings. Do not change it from this chat.',
    );
  }
  const thread = findThreadByRef(threadRef);
  if (!thread) throw new Error(`Thread not found: ${threadRef}`);
  if (isGlobalThread(thread) || thread.sourceType === 'orchestration') {
    throw new Error('CI and review wakes belong on a project workspace. Pass a worktree chat id.');
  }
  const on = enabled === true;
  const siblings = threadsSharingWorktree(thread.worktreePath);
  const targets = siblings.length > 0 ? siblings : [thread];
  let updated = thread;
  for (const row of targets) {
    const written = updateThread(row.id, { wakeOnGithubEdges: on ? true : undefined });
    if (!on) delete written.wakeOnGithubEdges;
    if (written.id === thread.id) updated = written;
  }
  return updated;
}
