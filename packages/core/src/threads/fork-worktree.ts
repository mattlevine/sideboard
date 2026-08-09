import { findThreadByRef } from '../store/thread-store.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { ForkThreadWorktreeInput, Thread } from '../types/thread.js';
import {
  buildForkTranscriptAttachment,
  forkMessageSlice,
} from './chat-tabs.js';
import { createThread } from './create.js';

function requireThread(idOrRef: string): Thread {
  const thread = findThreadByRef(idOrRef) ?? null;
  if (!thread) throw new Error(`Thread not found: ${idOrRef}`);
  return thread;
}

/** Fork into a new git worktree branched from the source thread's branch. */
export async function forkThreadWorktree(
  input: ForkThreadWorktreeInput,
  onSetupLine?: (line: string) => void,
): Promise<Thread> {
  const from = requireThread(input.threadId);
  if (isOrchestratorThread(from)) {
    throw new Error(
      'fork_worktree targets a worktree agent thread (not the orchestrator). Pass a child/worktree thread ref.',
    );
  }
  if (!from.branchName?.trim() || !from.repoPath?.trim()) {
    throw new Error(
      `Cannot fork worktree: thread ${from.id} has no branch/repo (need a real worktree chat).`,
    );
  }

  const slice = forkMessageSlice(from, input.throughIndex);
  const attachment = buildForkTranscriptAttachment(from.title || 'Chat', slice);

  // Same createThread path as ticket/branch create (worktree + setup scripts),
  // branched from the source workspace's current branch.
  const nextAgent = input.agent ?? from.agent;
  const nextModel =
    input.model !== undefined
      ? input.model
      : input.agent && input.agent !== from.agent
        ? null
        : from.model;

  const thread = await createThread(
    {
      sourceType: 'branch',
      sourceRef: from.branchName,
      repoPath: from.repoPath,
      agent: nextAgent,
      autonomy: from.autonomy,
      model: nextModel,
      effort: from.effort,
      fast: from.fast,
      planMode: from.planMode,
      title: input.title?.trim() || undefined,
      parentThreadId: from.id,
      attachments: [attachment],
    },
    onSetupLine,
  );

  return thread;
}
