import { findThreadByRef, updateThread } from '../store/thread-store.js';
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
  const slice = forkMessageSlice(from, input.throughIndex);
  const attachment = buildForkTranscriptAttachment(from.title || 'Chat', slice);

  const thread = await createThread(
    {
      sourceType: 'branch',
      sourceRef: from.branchName,
      repoPath: from.repoPath,
      agent: input.agent ?? from.agent,
      autonomy: from.autonomy,
      title: input.title?.trim() || undefined,
      parentThreadId: from.id,
    },
    onSetupLine,
  );

  return updateThread(thread.id, { attachments: [attachment] });
}
