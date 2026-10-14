import { archivedAgentsOnCheckout } from '../archive/fleet-archive.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import { listThreads, readThread } from '../store/thread-store.js';
import { threadsSharingWorktree } from '../threads/chat-tabs.js';
import type { Thread } from '../types/thread.js';

export type WorkspaceArchiveHost = {
  getThread(idOrRef: string): Thread | null;
  archive(threadRef: string): Promise<Thread>;
  restore(threadRef: string): Promise<Thread>;
};

function requireHostThread(host: WorkspaceArchiveHost, ref: string): Thread {
  const thread = host.getThread(ref);
  if (!thread) throw new Error(`Thread not found: ${ref}`);
  return thread;
}

/**
 * Archive every live agent on a checkout. The last one removes the worktree
 * (cowboy keeps the project folder). Orchestration chats are agents.
 */
export async function archiveWorkspaceAgents(
  host: WorkspaceArchiveHost,
  threadRef: string,
): Promise<Thread[]> {
  const thread = requireHostThread(host, threadRef);
  if (isOrchestratorThread(thread)) {
    throw new Error('Orchestration chats are agents, not workspaces. Use archive_chat.');
  }
  if (!thread.worktreePath?.trim()) {
    throw new Error('Chat has no workspace checkout. Use archive_chat.');
  }
  const chats = threadsSharingWorktree(thread.worktreePath);
  if (chats.length === 0) {
    throw new Error(
      'That workspace is already archived. Use list_archive, then restore_workspace to bring it back.',
    );
  }
  const archived: Thread[] = [];
  for (const chat of chats) {
    archived.push(await host.archive(chat.id));
  }
  return archived;
}

/**
 * Bring every archived agent on a checkout back. Recreates the worktree
 * when the folder is gone. Skips agents restored earlier so a retry finishes
 * the rest.
 */
export async function restoreWorkspaceAgents(
  host: WorkspaceArchiveHost,
  threadRef: string,
): Promise<Thread[]> {
  const thread = requireHostThread(host, threadRef);
  if (isOrchestratorThread(thread)) {
    throw new Error('Orchestration chats are agents, not workspaces. Use restore_chat.');
  }
  if (!thread.worktreePath?.trim()) {
    throw new Error('Chat has no workspace checkout. Use restore_chat.');
  }
  const targets = archivedAgentsOnCheckout(
    listThreads({ includeArchived: true }),
    thread.worktreePath,
  );
  const restored: Thread[] = [];
  for (const chat of targets) {
    const latest = readThread(chat.id);
    if (!latest || latest.status !== 'archived') continue;
    restored.push(await host.restore(latest.id));
  }
  if (restored.length === 0) {
    throw new Error(
      'No archived agents on this workspace. list_archive shows what can be restored.',
    );
  }
  return restored;
}
