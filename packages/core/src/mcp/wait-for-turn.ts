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
  'Child is still working. Call wait_for_turn again. Do not send a check-in prompt or assume a hang while progress is updating.';

export const MCP_WAIT_QUEUED_HINT =
  'Child is queued waiting for a concurrency slot — it has not started yet. Call wait_for_turn again. Do not send a check-in prompt, force_stop, or assume it failed to start.';

export function mcpWaitStillRunningHint(status: string): string {
  return status === 'queued' ? MCP_WAIT_QUEUED_HINT : MCP_WAIT_STILL_RUNNING_HINT;
}

export const MCP_WAIT_STOPPED_HINT =
  'Child was stopped before the turn finished. Do not treat this as success. send_to_thread to resume, or tell the user.';

export const MCP_WAIT_BROKEN_HINT =
  'Child worktree is broken (missing on disk). Tell the user — do not treat this as success.';

export const MCP_WAIT_ERROR_HINT =
  'Child turn failed. lastError/text is the failure — switch agent, tell the user, or retry. Do not treat empty text as success.';

/** Hint when wait_for_turn / get_turn_result is no longer stillRunning. */
export function mcpWaitFinishedHint(status: string): string | undefined {
  if (status === 'stopped') return MCP_WAIT_STOPPED_HINT;
  if (status === 'broken') return MCP_WAIT_BROKEN_HINT;
  if (status === 'error') return MCP_WAIT_ERROR_HINT;
  return undefined;
}
