import type { MessagePart, ThreadStatus } from '../types/thread.js';

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
 * | input-required   | turn ended on `ask_user`; the human must answer           |
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

const ASK_USER_TOOL = /(^|[_.:/])ask_user$/i;

/** True when the turn's last agent action was Sideboard `ask_user`. */
export function endedOnAskUser(parts: MessagePart[] | undefined): boolean {
  if (!parts?.length) return false;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.type === 'tool' && !p.parentId) {
      return ASK_USER_TOOL.test(p.name);
    }
  }
  return false;
}

export function deriveTaskState(input: {
  status: ThreadStatus | string;
  stillRunning: boolean;
  /** Parts of the last agent reply (not an injected notice). */
  lastAgentParts?: MessagePart[];
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
      return endedOnAskUser(input.lastAgentParts) ? 'input-required' : 'completed';
  }
}
