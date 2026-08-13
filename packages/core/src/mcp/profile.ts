/** Injected Sideboard MCP: worktree turns list UI tools only; orchestration gets the fleet. */
export type SideboardMcpProfile = 'worktree' | 'orchestration';

export const SIDEBOARD_MCP_PROFILE_ENV = 'SIDEBOARD_MCP_PROFILE';

export function sideboardMcpProfile(
  env: NodeJS.ProcessEnv = process.env,
): SideboardMcpProfile {
  return env[SIDEBOARD_MCP_PROFILE_ENV]?.trim().toLowerCase() === 'worktree'
    ? 'worktree'
    : 'orchestration';
}
