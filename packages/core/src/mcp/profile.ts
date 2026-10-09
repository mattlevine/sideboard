import { AGENT_RPC_NATIVE_ENV } from '../agent-rpc/protocol.js';
import { appDataDir } from '../store/paths.js';

/** Injected Sideboard MCP: worktree turns list UI + schedules + Account issue tools; orchestration gets the fleet. */
export type SideboardMcpProfile = 'worktree' | 'orchestration';

export const SIDEBOARD_MCP_PROFILE_ENV = 'SIDEBOARD_MCP_PROFILE';

/** Calling chat id on injected Sideboard MCP (worktree notify_orchestrator). */
export const SIDEBOARD_THREAD_ID_ENV = 'SIDEBOARD_THREAD_ID';

/**
 * True when the harness registers `present_artifact` / `wait_for_job` /
 * `stop_job` natively over Agent RPC, so this MCP must not duplicate them.
 */
export function agentRpcOwnsPilotTools(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[AGENT_RPC_NATIVE_ENV]?.trim() === '1';
}

/**
 * Env the injected Sideboard MCP child needs to join the host: same app-data
 * dir (desktop `pnpm dev` uses `.sideboard/dev-app-data`; a stripped Codex env
 * would otherwise write to ~/Library and hide children from the UI), the
 * profile, the calling thread, and whether Agent RPC owns the pilot tools.
 */
export function injectedSideboardMcpEnv(opts: {
  orchestratorThreadId?: string | null;
  threadId?: string | null;
  rpcNativeTools?: boolean;
}): Record<string, string> {
  const orchId = opts.orchestratorThreadId?.trim();
  const threadId = opts.threadId?.trim() || orchId;
  const env: Record<string, string> = {
    SIDEBOARD_APP_DATA: appDataDir(),
    [SIDEBOARD_MCP_PROFILE_ENV]: orchId ? 'orchestration' : 'worktree',
  };
  if (orchId) env.SIDEBOARD_ORCHESTRATOR_THREAD_ID = orchId;
  if (threadId) env[SIDEBOARD_THREAD_ID_ENV] = threadId;
  if (opts.rpcNativeTools) env[AGENT_RPC_NATIVE_ENV] = '1';
  return env;
}

/** Tools the Cursor worktree hook owns; injected MCP must omit them when the flag is set. */
export const AGENT_RPC_PILOT_MCP_TOOLS = [
  'present_artifact',
  'wait_for_job',
  'stop_job',
] as const;

/** Fleet tools Cursor orchestration owns on Agent RPC; omit from that harness MCP. */
export const AGENT_RPC_ORCH_MCP_TOOLS = ['wait_for_turn'] as const;

/** False when Cursor orchestration registers `wait_for_turn` as a native RPC tool. */
export function shouldRegisterMcpWaitForTurn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !agentRpcOwnsPilotTools(env);
}

/** Worktree MCP names after Agent RPC omit. `mcp/server.ts` registers from this list. */
export function worktreeMcpToolNames(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  if (!agentRpcOwnsPilotTools(env)) return WORKTREE_MCP_TOOLS;
  const omit = new Set<string>(AGENT_RPC_PILOT_MCP_TOOLS);
  return WORKTREE_MCP_TOOLS.filter((name) => !omit.has(name));
}

/** Full worktree MCP catalog. `worktreeMcpToolNames` drops Agent RPC pilots when native. */
export const WORKTREE_MCP_TOOLS = [
  'present_artifact',
  'ask_user',
  'present_plan',
  'present_schema',
  'present_files',
  'wait_for_job',
  'stop_job',
  'list_run_scripts',
  'run_dev_script',
  'stop_dev_script',
  'get_run_log',
  'notify_orchestrator',
  'get_viewer_context',
  'update_viewer_context',
  'list_env',
  'set_env',
  'delete_env',
  'list_schedules',
  'create_schedule',
  'update_schedule',
  'delete_schedule',
  'run_schedule',
] as const;

/** GitHub Issues via Account `gh` — always registered on worktree + orchestration. */
export const WORKTREE_GITHUB_MCP_TOOLS = [
  'github_search_issues',
  'github_get_issue',
  'github_download_attachment',
  'github_comment',
  'github_update_issue',
  'github_create_issue',
] as const;

/** Account Linear tools registered when Linear is connected. */
export const WORKTREE_LINEAR_MCP_TOOLS = [
  'linear_list_teams',
  'linear_search_issues',
  'linear_get_issue',
  'linear_download_attachment',
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
  'abletime_download_attachment',
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
