import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_RPC_NATIVE_ENV } from '../agent-rpc/protocol.js';
import {
  SIDEBOARD_MCP_PROFILE_ENV,
  SIDEBOARD_THREAD_ID_ENV,
  WORKTREE_ABLETIME_MCP_TOOLS,
  WORKTREE_GITHUB_MCP_TOOLS,
  WORKTREE_LINEAR_MCP_TOOLS,
  WORKTREE_MCP_TOOLS,
  agentRpcOwnsPilotTools,
  injectedSideboardMcpEnv,
  shouldRegisterMcpWaitForTurn,
  sideboardMcpProfile,
  worktreeMcpToolNames,
} from './profile.js';

describe('agentRpcOwnsPilotTools / injectedSideboardMcpEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off unless the injected env says the harness owns the pilot tools', () => {
    expect(agentRpcOwnsPilotTools({})).toBe(false);
    expect(agentRpcOwnsPilotTools({ [AGENT_RPC_NATIVE_ENV]: '0' })).toBe(false);
    expect(agentRpcOwnsPilotTools({ [AGENT_RPC_NATIVE_ENV]: '1' })).toBe(true);
  });

  it('omits the pilot tools from the worktree MCP catalog when Agent RPC owns them', () => {
    expect(worktreeMcpToolNames({})).toEqual([...WORKTREE_MCP_TOOLS]);
    const native = worktreeMcpToolNames({ [AGENT_RPC_NATIVE_ENV]: '1' });
    expect(native).not.toContain('present_artifact');
    expect(native).not.toContain('wait_for_job');
    expect(native).not.toContain('stop_job');
    expect(native).toContain('ask_user');
  });

  it('omits wait_for_turn from orchestration MCP when Agent RPC owns the native tools', () => {
    expect(shouldRegisterMcpWaitForTurn({})).toBe(true);
    expect(shouldRegisterMcpWaitForTurn({ [AGENT_RPC_NATIVE_ENV]: '1' })).toBe(false);
  });

  it('builds the worktree env and only sets the native flag when asked', () => {
    vi.stubEnv('SIDEBOARD_APP_DATA', '/tmp/sb-app-data');
    const plain = injectedSideboardMcpEnv({ threadId: 't1' });
    expect(plain.SIDEBOARD_APP_DATA).toBe('/tmp/sb-app-data');
    expect(plain[SIDEBOARD_MCP_PROFILE_ENV]).toBe('worktree');
    expect(plain[SIDEBOARD_THREAD_ID_ENV]).toBe('t1');
    expect(plain.SIDEBOARD_ORCHESTRATOR_THREAD_ID).toBeUndefined();
    expect(plain[AGENT_RPC_NATIVE_ENV]).toBeUndefined();
    expect(agentRpcOwnsPilotTools(plain)).toBe(false);

    const native = injectedSideboardMcpEnv({ threadId: 't1', rpcNativeTools: true });
    expect(agentRpcOwnsPilotTools(native)).toBe(true);
  });

  it('orchestration env carries the orchestrator id and falls back to it as the thread id', () => {
    const env = injectedSideboardMcpEnv({ orchestratorThreadId: ' orch-1 ' });
    expect(env[SIDEBOARD_MCP_PROFILE_ENV]).toBe('orchestration');
    expect(env.SIDEBOARD_ORCHESTRATOR_THREAD_ID).toBe('orch-1');
    expect(env[SIDEBOARD_THREAD_ID_ENV]).toBe('orch-1');
  });
});

describe('sideboardMcpProfile', () => {
  it('defaults to orchestration (CLI / Cursor MCP keep the fleet)', () => {
    expect(sideboardMcpProfile({})).toBe('orchestration');
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: '' })).toBe(
      'orchestration',
    );
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: 'orchestration' })).toBe(
      'orchestration',
    );
  });

  it('selects worktree when injected env says so', () => {
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: 'worktree' })).toBe(
      'worktree',
    );
    expect(sideboardMcpProfile({ [SIDEBOARD_MCP_PROFILE_ENV]: 'Worktree' })).toBe(
      'worktree',
    );
  });

  it('worktree MCP catalog is the UI tools plus wait_for_job, stop_job, run scripts, notify_orchestrator, and schedules', () => {
    expect([...WORKTREE_MCP_TOOLS]).toEqual([
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
      'set_workspace_tags',
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
    ]);
    expect(WORKTREE_MCP_TOOLS).not.toContain('list_chats');
    expect(WORKTREE_MCP_TOOLS).not.toContain('list_board');
    expect(WORKTREE_MCP_TOOLS).not.toContain('list_teams');
    expect([...WORKTREE_GITHUB_MCP_TOOLS]).toEqual([
      'github_search_issues',
      'github_list_projects',
      'github_get_issue',
      'github_download_attachment',
      'github_comment',
      'github_update_issue',
      'github_create_issue',
    ]);
    expect(WORKTREE_LINEAR_MCP_TOOLS).toContain('linear_comment');
    expect(WORKTREE_LINEAR_MCP_TOOLS).toContain('linear_download_attachment');
    expect(WORKTREE_ABLETIME_MCP_TOOLS).toContain('abletime_comment');
    expect(WORKTREE_ABLETIME_MCP_TOOLS).toContain('abletime_download_attachment');
    expect(WORKTREE_ABLETIME_MCP_TOOLS).toContain('abletime_update_task');
  });
});
