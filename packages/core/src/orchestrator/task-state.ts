import {
  extractPendingPlanQuestions,
  isAskUserToolName,
  lastTopLevelToolIsAskUser,
} from '../plan/ask-user.js';
import type { MessagePart, ThreadStatus, TokenUsage } from '../types/thread.js';

/**
 * Lifecycle of one worktree turn, in A2A (Agent2Agent) task vocabulary.
 *
 * Sideboard `ThreadStatus` is a process/liveness field (`queued`, `running`,
 * `idle`, `stopped`, `error`, `broken`, …) and `stillRunning` is derived from
 * heartbeats. Coordinators had to combine both plus prose hints to know what
 * happened. `TaskState` collapses that into one value:
 *
 * | taskState        | meaning                                                   |
 * |------------------|-----------------------------------------------------------|
 * | submitted        | queued — waiting for a concurrency slot, not started      |
 * | working          | the agent is running this turn                            |
 * | input-required   | unanswered `ask_user`, even if a later tool ran           |
 * | completed        | turn ended with an answer                                 |
 * | failed           | runner / agent error, or worktree missing (`broken`)      |
 * | canceled         | force-stopped before finishing                            |
 *
 * `rejected` and `auth-required` exist in A2A but have no Sideboard source yet.
 * See docs/system/agent-orchestration.md.
 */
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

/** Terminal states — the child is not going to do more on its own. */
export function isTerminalTaskState(state: TaskState): boolean {
  return state !== 'submitted' && state !== 'working';
}

/** Terminal but not a finished answer — the coordinator has to act. */
export function isIncompleteTaskState(state: TaskState): boolean {
  return state === 'failed' || state === 'canceled';
}

/** Terminal and not a successful answer (includes waiting on the user). */
export function needsCoordinatorAction(state: TaskState): boolean {
  return isIncompleteTaskState(state) || state === 'input-required';
}

/** True when the turn's last agent action was `ask_user` / AskUserQuestion. */
export function endedOnAskUser(parts: MessagePart[] | undefined): boolean {
  return lastTopLevelToolIsAskUser(parts);
}

/**
 * True when a top-level ask_user is still in the turn. A later tool does not
 * finish the question. A skipped signature does. A later user reply is
 * `userAnswered` on {@link deriveTaskState}.
 */
export function turnWaitingOnAskUser(
  parts: MessagePart[] | undefined,
  dismissedQuestionSignature?: string | null,
): boolean {
  if (!parts?.length) return false;
  let ask: MessagePart | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.type === 'tool' && !part.parentId && isAskUserToolName(part.name)) {
      ask = part;
      break;
    }
  }
  if (!ask) return false;
  const dismissed = dismissedQuestionSignature?.trim();
  if (!dismissed) return true;
  const pending = extractPendingPlanQuestions([ask]);
  if (!pending?.signature) return false;
  return pending.signature !== dismissed;
}

export function deriveTaskState(input: {
  status: ThreadStatus | string;
  stillRunning: boolean;
  /** Parts of the last agent reply (not an injected notice). */
  lastAgentParts?: MessagePart[];
  dismissedQuestionSignature?: string | null;
  /** A real user message landed after the agent reply that asked. */
  userAnswered?: boolean;
}): TaskState {
  if (input.stillRunning) {
    return input.status === 'queued' ? 'submitted' : 'working';
  }
  switch (input.status) {
    case 'error':
    case 'broken':
      return 'failed';
    case 'stopped':
      return 'canceled';
    default:
      return !input.userAnswered &&
        turnWaitingOnAskUser(input.lastAgentParts, input.dismissedQuestionSignature)
        ? 'input-required'
        : 'completed';
  }
}

/** Snapshot returned by `getTurnResult`. Block fields are optional so older test doubles typecheck. */
export type TurnResult = {
  text: string;
  status: string;
  taskState: TaskState;
  sessionId: string | null;
  lastError: string | null;
  stillRunning: boolean;
  progress: string | null;
  lastActivityAt: string | null;
  usage: TokenUsage | null;
  blockedReason?: string | null;
  blockedSource?: 'ask_user' | 'plan' | 'reported' | 'permission' | null;
};
