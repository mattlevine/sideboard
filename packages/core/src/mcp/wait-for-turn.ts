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
