import { expandCanonicalGitRequest } from '../git/agent-git-actions.js';
import type { GitForge } from '../git/remote-forge.js';
import {
  joinSteerPrompt,
  livePartsShowAgentReply,
  trailingUnansweredUserText,
  userMessagesCoverPrompt,
} from '../composer/agent-has-replied.js';
import { expandComposerPrompt } from '../composer/expand.js';
import {
  alignQueueAttachments,
  appendQueuedItem,
  consumeComposerAttachments,
  mergeTurnAttachments,
  sameTurnAttachments,
} from '../composer/consume-attachments.js';
import { thisProcessShouldDrainAgentQueues } from '../store/desktop-host.js';
import { appendMessage, readThread, updateThread, withThreadLock } from '../store/thread-store.js';
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

export function beginOpenSteerDraft(text: string): OpenSteerDraft {
  return { text, spawned: false, attachments: [] };
}

/** Park this turn's files on the draft, then return the list the user bubble should show. */
export function seedOpenSteerAttachments(
  draft: OpenSteerDraft | undefined,
  sent: ThreadAttachment[] | undefined,
): ThreadAttachment[] {
  if (!draft) return [...(sent ?? [])];
  draft.attachments = mergeTurnAttachments(sent, draft.attachments);
  return draft.attachments ?? [];
}

/** Files to expand into the agent prompt. Continue turns never resend images. */
export function openSteerTurnAttachments(
  draft: OpenSteerDraft | undefined,
  fallback: ThreadAttachment[],
  autoContinue: boolean,
): ThreadAttachment[] {
  if (autoContinue) return [];
  return [...(draft?.attachments ?? fallback)];
}

/** Mark the draft spawned and rebuild the prompt if a follow-up image arrived late. */
export function promptAfterJoinedSteer(input: {
  draft: OpenSteerDraft | undefined;
  autoContinue: boolean;
  expandedAttachments: ThreadAttachment[];
  threadId: string;
  promptText: string;
  agentPrompt: string;
  expandedPrompt: string;
  worktreePath: string;
  gitForge?: GitForge | null;
}): string {
  if (input.draft) input.draft.spawned = true;
  return promptForJoinedSteer({
    threadId: input.threadId,
    promptText: input.promptText,
    latestPrompt: input.draft?.text ?? input.promptText,
    agentPrompt: input.agentPrompt,
    expandedPrompt: input.expandedPrompt,
    worktreePath: input.worktreePath,
    attachments: input.expandedAttachments,
    latestAttachments: openSteerTurnAttachments(
      input.draft,
      input.expandedAttachments,
      input.autoContinue,
    ),
    gitForge: input.gitForge,
  });
}

export type OpenSteerDraft = {
  text: string;
  spawned: boolean;
  /**
   * Files this unanswered turn should send. Steer follow-ups that arrive
   * before the process starts append here — the text join alone used to drop
   * images, so the agent was spawned without them.
   */
  attachments?: ThreadAttachment[];
};

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

/** The new line when `combined` is `joinSteerPrompt(base, addition)`. */
function steerAddition(base: string, combined: string): string | null {
  if (!combined || combined === base) return null;
  const prefix = base.replace(/\s+$/, '');
  const head = prefix ? `${prefix}\n` : '';
  if (!head || !combined.startsWith(head)) return null;
  const addition = combined.slice(head.length).trim();
  return addition || null;
}

/**
 * A follow-up that arrives before the agent replies is still one prompt for
 * the model. Once the earlier line is already its own transcript bubble,
 * keep that bubble and store the new line under it. Rewriting the earlier
 * bubble made the two sends look like one message.
 */
function recordSeparateSteerFollowUp(
  threadId: string,
  base: string,
  combined: string,
  attachments?: ThreadAttachment[],
): void {
  const thread = readThread(threadId);
  if (!thread) return;
  if (userMessagesCoverPrompt(thread.messages, combined)) return;
  if (!userMessagesCoverPrompt(thread.messages, base)) return;
  const addition = steerAddition(base, combined);
  if (!addition) return;
  const extra = attachments ?? [];
  appendMessage(threadId, {
    role: 'user',
    text: addition,
    ts: new Date().toISOString(),
    ...(extra.length > 0 ? { attachments: extra } : {}),
  });
}

/**
 * Skip appending the joined prompt when the transcript already shows it,
 * either as one bubble or as the separate sends joined for the agent.
 * Returns true when `appendMessage` should be skipped.
 */
export function reuseJoinedUserBubble(
  reused: { delete(id: string): boolean },
  _threadId: string,
  messages: ThreadMessage[],
  promptText: string,
): boolean {
  if (!reused.delete(_threadId)) return false;
  // Separate bubbles (`A` then `B`) already show the joined prompt `A\nB`.
  // A rewritten row can also sit above a partial agent reply — appending
  // again would duplicate that prompt.
  return userMessagesCoverPrompt(messages, promptText);
}

/** Swap the expanded prompt when steer joined more text after expansion. */
export function promptForJoinedSteer(input: {
  threadId: string;
  promptText: string;
  latestPrompt: string;
  agentPrompt: string;
  expandedPrompt: string;
  worktreePath: string;
  /** Files already baked into `expandedPrompt`. */
  attachments: ThreadAttachment[];
  /** Files the turn should send now, including a follow-up image. */
  latestAttachments?: ThreadAttachment[];
  gitForge?: GitForge | null;
}): string {
  const latestAttachments = input.latestAttachments ?? input.attachments;
  const textSame = input.latestPrompt === input.promptText;
  if (textSame && sameTurnAttachments(input.attachments, latestAttachments)) {
    return input.agentPrompt;
  }
  if (!textSame) {
    recordSeparateSteerFollowUp(input.threadId, input.promptText, input.latestPrompt);
  }
  const { agentPrompt: expandedLatest } = expandComposerPrompt(
    input.worktreePath,
    expandCanonicalGitRequest(input.latestPrompt, { forge: input.gitForge }),
    { attachments: latestAttachments },
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
 * If that earlier line is already its own transcript bubble, the new line is
 * stored under it rather than rewritten into the same bubble.
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
        if (consumed.consumed.length > 0) {
          draft.attachments = mergeTurnAttachments(draft.attachments, consumed.consumed);
        }
        recordSeparateSteerFollowUp(current.id, unanswered, combined, consumed.consumed);
        // The process has not been spawned, so this image never reaches a queue
        // slot. Clear the composer or the chip sits in the box after send.
        if (explicit === undefined && consumed.consumed.length > 0) {
          updateThread(current.id, { attachments: consumed.attachments });
        }
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
      if (draft) {
        draft.text = promptToQueue;
        if (consumed.consumed.length > 0) {
          draft.attachments = mergeTurnAttachments(draft.attachments, consumed.consumed);
        }
      }
      recordSeparateSteerFollowUp(current.id, unanswered, promptToQueue, consumed.consumed);
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
