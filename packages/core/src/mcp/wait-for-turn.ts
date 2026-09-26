import type { TaskState } from '../orchestrator/task-state.js';

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
  'Child is still working. Call wait_for_turn again. Do not send_to_thread a check-in (that steers / interrupts) or assume a hang while progress is updating.';

export const MCP_WAIT_QUEUED_HINT =
  'Child is queued waiting for a concurrency slot — it has not started yet. Call wait_for_turn again. Do not send_to_thread a check-in (that steers / interrupts), force_stop, or assume it failed to start.';

export function mcpWaitStillRunningHint(status: string): string {
  return status === 'queued' ? MCP_WAIT_QUEUED_HINT : MCP_WAIT_STILL_RUNNING_HINT;
}

export const MCP_WAIT_STOPPED_HINT =
  'Child was stopped before the turn finished. Do not treat this as success. send_to_thread to resume, or tell the user.';

export const MCP_WAIT_BROKEN_HINT =
  'Child worktree is broken (missing on disk). Tell the user — do not treat this as success.';

export const MCP_WAIT_ERROR_HINT =
  'Child turn failed. lastError/text is the failure — switch agent, tell the user, or retry. Do not treat empty text as success.';

export const MCP_WAIT_INPUT_REQUIRED_HINT =
  'Child asked the user a question (ask_user). taskState is input-required. Wait for the user to answer in that chat — do not send_to_thread a check-in.';

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
): string | undefined {
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
