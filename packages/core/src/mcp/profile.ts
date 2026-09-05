/** Injected Sideboard MCP: worktree turns list UI + Account issue tools; orchestration gets the fleet. */
export type SideboardMcpProfile = 'worktree' | 'orchestration';

export const SIDEBOARD_MCP_PROFILE_ENV = 'SIDEBOARD_MCP_PROFILE';

/** UI tools always registered when SIDEBOARD_MCP_PROFILE=worktree (coding chats). */
export const WORKTREE_MCP_TOOLS = [
  'present_artifact',
  'ask_user',
  'present_plan',
  'present_schema',
  'present_files',
  'wait_for_job',
] as const;

/** GitHub Issues via Account `gh` — always registered on worktree + orchestration. */
export const WORKTREE_GITHUB_MCP_TOOLS = [
  'github_get_issue',
  'github_comment',
  'github_update_issue',
  'github_create_issue',
] as const;

/** Account Linear tools registered when Linear is connected. */
export const WORKTREE_LINEAR_MCP_TOOLS = [
  'linear_list_teams',
  'linear_search_issues',
  'linear_get_issue',
  'linear_create_issue',
  'linear_update_issue',
  'linear_comment',
] as const;

/** Account AbleTime tools registered when AbleTime is connected. */
export const WORKTREE_ABLETIME_MCP_TOOLS = [
  'abletime_orientation',
  'abletime_list_projects',
  'abletime_list_tasks',
  'abletime_search_tasks',
  'abletime_get_task',
  'abletime_comment',
  'abletime_update_task',
  'abletime_create_task',
  'abletime_ensure_task',
] as const;

export function sideboardMcpProfile(
  env: NodeJS.ProcessEnv = process.env,
): SideboardMcpProfile {
  return env[SIDEBOARD_MCP_PROFILE_ENV]?.trim().toLowerCase() === 'worktree'
    ? 'worktree'
    : 'orchestration';
}
