import { expandCanonicalGitRequest } from '../git/agent-git-actions.js';
import type { GitForge } from '../git/remote-forge.js';
import {
  joinSteerPrompt,
  livePartsShowAgentReply,
  trailingUnansweredUserText,
} from '../composer/agent-has-replied.js';
import { expandComposerPrompt } from '../composer/expand.js';
import {
  alignQueueAttachments,
  appendQueuedItem,
  consumeComposerAttachments,
} from '../composer/consume-attachments.js';
import { thisProcessShouldDrainAgentQueues } from '../store/desktop-host.js';
import { readThread, updateThread, withThreadLock } from '../store/thread-store.js';
import { readTurnLiveParts } from '../store/turn-live.js';
import { followUpBehavior, type FollowUpBehavior } from '../store/app-settings.js';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { OrchestratorEvent, Thread, ThreadAttachment, ThreadMessage } from '../types/thread.js';

/**
 * Desktop/CLI pass follow-up explicitly. Internal sends (child-halt
 * "Sideboard: …" notices, Slack, schedules) omit it — orchestrators then
 * use Settings → Follow-up behavior (default steer) so those do not sit
 * in the queue while the user asked to interrupt.
 *
 * Orchestrator → worktree talk (`send_to_chat`, `ask_git`) must
 * pass {@link resolveOrchChildFollowUp} so those prompts steer by default.
 * Create/reuse first prompts still queue unless the caller opts in.
 */
export function resolveSendFollowUp(
  thread: Pick<Thread, 'sourceType' | 'repoPath'>,
  requested?: FollowUpBehavior,
): FollowUpBehavior {
  if (requested === 'steer' || requested === 'queue') return requested;
  return isOrchestratorThread(thread) ? followUpBehavior() : 'queue';
}

export type OpenSteerDraft = { text: string; spawned: boolean };

/** Maps and callbacks `send` needs without pulling the orchestrator class along. */
export type EnqueueSendHost = {
  activeTurns: { has(id: string): boolean };
  startingTurns: { has(id: string): boolean };
  openSteerPrompt: Map<string, OpenSteerDraft>;
  reusedUserPrompt: Set<string>;
  crashContinued: { delete(id: string): void };
  jobContinueCount: { delete(id: string): void };
  jobContinueNudged: { delete(id: string): void };
  haltDrain: { delete(id: string): void };
  emit(event: OrchestratorEvent): void;
  armDrain(threadId: string): void;
  requireThread(ref: string): Thread;
  pidAlive(pid: number): boolean;
};

/** Replace the unanswered user bubble when a steer follow-up is joined onto it. */
export function rewriteTrailingUserPrompt(threadId: string, from: string, to: string): void {
  if (from === to) return;
  const thread = readThread(threadId);
  if (!thread) return;
  const messages = thread.messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.origin === 'continue' || message.role === 'summary') continue;
    if (message.role === 'user' && message.text === from) {
      messages[i] = { ...message, text: to };
      updateThread(threadId, { messages });
    }
    return;
  }
}

/**
 * Keep the user bubble already rewritten when steer joined onto a prompt the
 * process was spawned with. Returns true when `appendMessage` should be skipped.
 */
export function reuseJoinedUserBubble(
  reused: { delete(id: string): boolean },
  threadId: string,
  last: ThreadMessage | undefined,
  promptText: string,
): boolean {
  return (
    reused.delete(threadId) &&
    last?.role === 'user' &&
    last.origin !== 'continue' &&
    last.text === promptText
  );
}

/** Swap the expanded prompt when steer joined more text after expansion. */
export function promptForJoinedSteer(input: {
  threadId: string;
  promptText: string;
  latestPrompt: string;
  agentPrompt: string;
  expandedPrompt: string;
  worktreePath: string;
  attachments: ThreadAttachment[];
  gitForge?: GitForge | null;
}): string {
  if (input.latestPrompt === input.promptText) return input.agentPrompt;
  rewriteTrailingUserPrompt(input.threadId, input.promptText, input.latestPrompt);
  const { agentPrompt: expandedLatest } = expandComposerPrompt(
    input.worktreePath,
    expandCanonicalGitRequest(input.latestPrompt, { forge: input.gitForge }),
    { attachments: input.attachments },
  );
  return input.expandedPrompt && input.agentPrompt.endsWith(input.expandedPrompt)
    ? input.agentPrompt.slice(0, -input.expandedPrompt.length) + expandedLatest
    : `${input.agentPrompt}\n\n${expandedLatest}`;
}

function clearSendBookkeeping(host: EnqueueSendHost, threadId: string): void {
  host.crashContinued.delete(threadId);
  host.jobContinueCount.delete(threadId);
  host.jobContinueNudged.delete(threadId);
  host.haltDrain.delete(threadId);
}

/**
 * Queue a prompt. A steer that arrives before the agent has replied is joined
 * onto the open prompt (`Work on issue A` + `And B`) instead of replacing it.
 * Returns whether the caller should still interrupt via send-now.
 */
export async function enqueueThreadSend(
  host: EnqueueSendHost,
  threadRef: string,
  prompt: string,
  opts?: { followUp?: FollowUpBehavior; attachments?: Thread['attachments'] },
): Promise<{ thread: Thread; shouldSteer: boolean }> {
  const thread = host.requireThread(threadRef);
  if (thread.status === 'archived') {
    throw new Error(`Thread is archived: ${thread.id}`);
  }
  let shouldSteer = false;
  const sent = await withThreadLock(thread.id, async () => {
    const current = host.requireThread(thread.id);
    if (current.status === 'archived') {
      throw new Error(`Thread is archived: ${thread.id}`);
    }
    const followUp = resolveSendFollowUp(current, opts?.followUp);
    // [] is this turn's files. Omitting attachments takes chips staged on the Mac.
    const explicit = opts?.attachments;
    const consumed =
      explicit !== undefined
        ? { attachments: current.attachments, consumed: explicit }
        : consumeComposerAttachments(current);
    const inFlightEarly =
      host.activeTurns.has(thread.id) ||
      host.startingTurns.has(thread.id) ||
      current.status === 'running';
    const agentHasRepliedEarly = livePartsShowAgentReply(readTurnLiveParts(current.id));
    const draft = host.openSteerPrompt.get(current.id);
    const queuedHead =
      !inFlightEarly && current.status === 'queued' && current.queue.length > 0
        ? current.queue[0]!
        : null;
    const unanswered =
      followUp === 'steer' && !agentHasRepliedEarly
        ? (draft?.text ?? (inFlightEarly ? trailingUnansweredUserText(current.messages) : queuedHead))
        : null;
    // Before any agent output, steer appends onto the open prompt so the
    // agent is sent one message ("Work on issue A" + "And B"). After the
    // agent has replied, steer still interrupts and jumps the new text ahead.
    if (unanswered != null && (draft ? !draft.spawned : queuedHead != null)) {
      clearSendBookkeeping(host, thread.id);
      const combined = joinSteerPrompt(unanswered, prompt);
      if (draft && !draft.spawned) {
        draft.text = combined;
        rewriteTrailingUserPrompt(current.id, unanswered, combined);
      } else {
        const queue = current.queue.slice();
        queue[0] = combined;
        const queueAttachments = alignQueueAttachments(queue.length, current.queueAttachments);
        if (consumed.consumed.length > 0) {
          queueAttachments[0] = [...(queueAttachments[0] ?? []), ...consumed.consumed];
        }
        const patch: Partial<Thread> = { queue, queueAttachments };
        if (explicit === undefined && consumed.consumed.length > 0) {
          patch.attachments = consumed.attachments;
        }
        updateThread(current.id, patch);
        host.emit({ type: 'queue_changed', threadId: current.id, queue });
      }
      if (thisProcessShouldDrainAgentQueues() && !inFlightEarly) {
        host.armDrain(current.id);
      }
      return host.requireThread(current.id);
    }
    const promptToQueue = unanswered != null ? joinSteerPrompt(unanswered, prompt) : prompt;
    if (unanswered != null) {
      if (draft) draft.text = promptToQueue;
      rewriteTrailingUserPrompt(current.id, unanswered, promptToQueue);
      host.reusedUserPrompt.add(current.id);
    }
    const queued = appendQueuedItem(
      current.queue,
      current.queueAttachments,
      promptToQueue,
      consumed.consumed,
    );
    clearSendBookkeeping(host, thread.id);
    const inFlight =
      host.activeTurns.has(thread.id) ||
      host.startingTurns.has(thread.id) ||
      current.status === 'running';
    // Same interrupt as before: a running turn, or anything already parked.
    // A follow-up that was joined onto a prompt the process has not received
    // yet returned above and does not start a second turn.
    shouldSteer = followUp === 'steer' && (inFlight || current.queue.length > 0);
    const patch: Partial<Thread> = queued;
    if (explicit === undefined && consumed.consumed.length > 0) {
      patch.attachments = consumed.attachments;
    }
    if (!inFlight) patch.status = 'queued';
    // Stale agentPid from a dead MCP/desktop child can pin drainQueue forever.
    const pid = current.agentPid;
    if (typeof pid === 'number' && pid > 0 && !host.pidAlive(pid)) {
      patch.agentPid = null;
    }
    updateThread(thread.id, patch);
    host.emit({ type: 'queue_changed', threadId: thread.id, queue: queued.queue });
    if (!inFlight) {
      host.emit({ type: 'status_changed', threadId: thread.id, status: 'queued' });
    }
    // MCP/CLI enqueue only while the board is alive — otherwise the turn
    // runs in a stdio child with no renderer IPC (blank worktree chat).
    // Steer promotes via sendQueuedMessageNow after the lock.
    if (thisProcessShouldDrainAgentQueues() && !shouldSteer) {
      host.armDrain(thread.id);
    }
    return host.requireThread(thread.id);
  });
  return { thread: sent, shouldSteer };
}
