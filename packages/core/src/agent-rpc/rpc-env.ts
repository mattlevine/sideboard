import { agentRpcConnectFromMetadata, type AgentRpcConnect } from './metadata.js';
import {
  AGENT_RPC_CWD_ENV,
  AGENT_RPC_NATIVE_ENV,
  AGENT_RPC_TOKEN_ENV,
  AGENT_RPC_URL_ENV,
} from './protocol.js';

/** Worktree Claude/OpenCode attach when the desktop pid is live; their orchestration stays on MCP. Cursor orchestration attaches in `cursor.ts`. */
export function worktreeAgentRpc(isOrchestrator: boolean): AgentRpcConnect | null {
  return isOrchestrator ? null : agentRpcConnectFromMetadata();
}

/** Env the CLI child (OpenCode plugin, Claude runner) uses to reach Agent RPC. */
export function agentRpcChildEnv(
  rpc: AgentRpcConnect,
  cwd: string,
): Record<string, string> {
  return {
    [AGENT_RPC_NATIVE_ENV]: '1',
    [AGENT_RPC_URL_ENV]: rpc.url,
    [AGENT_RPC_TOKEN_ENV]: rpc.authToken,
    [AGENT_RPC_CWD_ENV]: cwd,
  };
}
