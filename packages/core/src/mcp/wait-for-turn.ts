import { needsCoordinatorAction, type TaskState } from '../orchestrator/task-state.js';
import type { AgentBlockSource, TokenUsage } from '../types/thread.js';

/**
 * MCP clients (Cursor, Claude Code) often kill a tool call around 60s.
 * wait_for_turn must return before that with a progress snapshot so the
 * coordinator can loop instead of assuming the worktree hung.
 */
export const MCP_WAIT_FOR_TURN_MAX_MS = 45_000;

export function mcpWaitForTurnTimeoutMs(requested?: number): number {
  const n = requested ?? MCP_WAIT_FOR_TURN_MAX_MS;
  if (!Number.isFinite(n)) return MCP_WAIT_FOR_TURN_MAX_MS;
  return Math.min(Math.max(1_000, Math.floor(n)), MCP_WAIT_FOR_TURN_MAX_MS);
}

export const MCP_WAIT_STILL_RUNNING_HINT =
  'Child is still working. Call wait_for_turn again. Do not send_to_chat a check-in (that steers / interrupts) or assume a hang while progress is updating.';

export const MCP_WAIT_QUEUED_HINT =
  'Child is queued waiting for a concurrency slot — it has not started yet. Call wait_for_turn again. Do not send_to_chat a check-in (that steers / interrupts), force_stop, or assume it failed to start.';

export function mcpWaitStillRunningHint(status: string): string {
  return status === 'queued' ? MCP_WAIT_QUEUED_HINT : MCP_WAIT_STILL_RUNNING_HINT;
}

export const MCP_WAIT_STOPPED_HINT =
  'Child was stopped before the turn finished. Do not treat this as success. send_to_chat to resume, or tell the user.';

export const MCP_WAIT_BROKEN_HINT =
  'Child worktree is broken (missing on disk). Tell the user — do not treat this as success.';

export const MCP_WAIT_ERROR_HINT =
  'Child turn failed. lastError/text is the failure — switch agent, tell the user, or retry. Do not treat empty text as success.';

export const MCP_WAIT_INPUT_REQUIRED_HINT =
  'Child asked the user a question (ask_user). taskState is input-required. Wait for the user to answer in that chat — do not send_to_chat a check-in.';

/** Hint when wait_for_turn / get_turn_result is no longer stillRunning. */
export function mcpWaitFinishedHint(status: string): string | undefined {
  if (status === 'stopped') return MCP_WAIT_STOPPED_HINT;
  if (status === 'broken') return MCP_WAIT_BROKEN_HINT;
  if (status === 'error') return MCP_WAIT_ERROR_HINT;
  return undefined;
}

/**
 * Coordinator hint from A2A-style taskState (preferred over ThreadStatus).
 * `status` still distinguishes broken vs other failures.
 */
export function mcpWaitTaskHint(
  taskState: TaskState,
  status?: string,
  blockedReason?: string | null,
): string | undefined {
  const why = blockedReason?.trim();
  if (why && taskState !== 'failed' && taskState !== 'canceled') {
    if (taskState === 'submitted' || taskState === 'working') {
      return `Child is blocked: ${why} It has not finished the turn. Do not send_to_chat a check-in.`;
    }
    if (taskState === 'input-required') {
      return `Child is blocked: ${why} Wait for the user in that chat — do not send_to_chat a check-in.`;
    }
    return `Child is blocked: ${why} Help if this is your child; otherwise tell the user. Do not send_to_chat a check-in.`;
  }
  switch (taskState) {
    case 'submitted':
      return MCP_WAIT_QUEUED_HINT;
    case 'working':
      return MCP_WAIT_STILL_RUNNING_HINT;
    case 'input-required':
      return MCP_WAIT_INPUT_REQUIRED_HINT;
    case 'canceled':
      return MCP_WAIT_STOPPED_HINT;
    case 'failed':
      return status === 'broken' ? MCP_WAIT_BROKEN_HINT : MCP_WAIT_ERROR_HINT;
    default:
      return undefined;
  }
}

export function nonemptyIso(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Live sidecar while running; last transcript/thread stamp once the turn ends. */
export function lastActivityAtForWait(
  stillRunning: boolean,
  liveUpdatedAt: string | null | undefined,
  fallbacks: Array<string | null | undefined>,
): string | null {
  if (stillRunning) return nonemptyIso(liveUpdatedAt);
  for (const value of fallbacks) {
    const iso = nonemptyIso(value);
    if (iso) return iso;
  }
  return null;
}

/** Payload for MCP `wait_for_turn` and Agent RPC `turn.wait`. */
export type WaitForTurnToolResult = {
  id: string;
  status: string;
  taskState: TaskState;
  text: string;
  lastError: string | null;
  stillRunning: boolean;
  progress: string | null;
  lastActivityAt: string | null;
  /** Last finished agent turn tokens + costUsd when reported. Null while stillRunning. costUsd is this turn; sessionCostUsd is the provider session total when present. */
  usage: TokenUsage | null;
  /**
   * Why the child is waiting on a person. Omitted on older fixtures;
   * live results always set it (null when not blocked).
   */
  blockedReason?: string | null;
  blockedSource?: AgentBlockSource | null;
  hint: string | undefined;
  incomplete: boolean;
};

export function waitForTurnToolResult(input: {
  id: string;
  status: string;
  taskState: TaskState;
  text: string;
  lastError: string | null;
  stillRunning: boolean;
  progress: string | null;
  lastActivityAt: string | null;
  usage?: TokenUsage | null;
  blockedReason?: string | null;
  blockedSource?: AgentBlockSource | null;
}): WaitForTurnToolResult {
  const blockedReason = input.blockedReason?.trim() ? input.blockedReason.trim() : null;
  const waiting =
    Boolean(blockedReason) &&
    !input.stillRunning &&
    input.taskState !== 'failed' &&
    input.taskState !== 'canceled';
  return {
    ...input,
    usage: input.usage ?? null,
    blockedReason,
    blockedSource: blockedReason ? input.blockedSource ?? null : null,
    hint: mcpWaitTaskHint(input.taskState, input.status, blockedReason),
    incomplete: needsCoordinatorAction(input.taskState) || waiting,
  };
}
