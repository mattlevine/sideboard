import { isGlobalThread } from '../store/global-workspace.js';
import { findThreadByRef, updateThread } from '../store/thread-store.js';
import type { Thread } from '../types/thread.js';
import { threadsSharingWorktree } from './chat-tabs.js';
import {
  normalizeWorkspaceTags,
  normalizeWorktreePath,
  workspaceTagsFromGroup,
} from '../git/worktree-labels.js';

type TagTarget = Pick<Thread, 'id' | 'worktreePath' | 'sourceType' | 'repoPath'>;

/**
 * Which chat a tag write applies to. Worktree agents may only retag their
 * own checkout. Orchestrators pass any project-workspace chat id.
 */
export function workspaceTagTargetRef(opts: {
  ownWorktreeOnly: boolean;
  caller: TagTarget | null;
  requestedRef?: string | null;
  find: (ref: string) => TagTarget | null;
}): string {
  const requested = opts.requestedRef?.trim() || '';
  if (!opts.ownWorktreeOnly) {
    if (!requested) throw new Error('Pass a chat id on the workspace to label.');
    return requested;
  }
  const caller = opts.caller;
  if (!caller || isGlobalThread(caller) || caller.sourceType === 'orchestration') {
    throw new Error('Tags belong on a project workspace. This chat is not one.');
  }
  if (!requested || requested === caller.id) return caller.id;
  const other = opts.find(requested);
  if (
    !other ||
    normalizeWorktreePath(other.worktreePath) !== normalizeWorktreePath(caller.worktreePath)
  ) {
    throw new Error('You can only change tags on this workspace.');
  }
  return other.id;
}

export type WorkspaceTagMode = 'replace' | 'add' | 'remove';

/**
 * Tags are shared by every live chat on one project workspace. Orchestration
 * chats share a synthetic cwd, so a tag written there would label the whole
 * fleet — refuse that and ask for a worktree chat.
 */
export function applyWorkspaceTags(
  threadRef: string,
  tags: unknown,
  mode: WorkspaceTagMode = 'replace',
): Thread {
  const thread = findThreadByRef(threadRef);
  if (!thread) throw new Error(`Thread not found: ${threadRef}`);
  if (isGlobalThread(thread) || thread.sourceType === 'orchestration') {
    throw new Error('Tags belong on a project workspace. Pass a worktree chat id.');
  }
  const incoming = normalizeWorkspaceTags(tags);
  const siblings = threadsSharingWorktree(thread.worktreePath);
  const current = workspaceTagsFromGroup(siblings.length > 0 ? siblings : [thread]);
  let next: string[];
  if (mode === 'add') {
    next = normalizeWorkspaceTags([...current, ...incoming]);
  } else if (mode === 'remove') {
    const drop = new Set(incoming.map((tag) => tag.toLowerCase()));
    next = current.filter((tag) => !drop.has(tag.toLowerCase()));
  } else {
    next = incoming;
  }
  const targets = siblings.length > 0 ? siblings : [thread];
  let updated = thread;
  for (const row of targets) {
    const written = updateThread(row.id, { tags: next });
    if (written.id === thread.id) updated = written;
  }
  return updated;
}
