import type { AgentRpcConnect } from '../agent-rpc/metadata.js';

/** JSON payload written to the Cursor runner on stdin. */
export type CursorTurnRequest = {
  prompt: string;
  cwd: string;
  /** Isolates the JSONL catalog so concurrent Cursor runners do not clobber runs. */
  threadId?: string | null;
  agentId?: string | null;
  model?: string | null;
  /** Reasoning effort (independent of {@link CursorTurnRequest.fast}). */
  effort?: string | null;
  fast?: boolean;
  planMode?: boolean;
  apiKey?: string;
  /**
   * Orchestration: skip ~/.cursor/mcp.json and project MCP (Linear, …).
   * Inline {@link CursorTurnRequest.mcpServers} still apply.
   */
  isolateAmbientMcp?: boolean;
  /**
   * Live desktop Agent RPC endpoint. When set, the runner registers
   * present_artifact / wait_for_job / stop_job as native `customTools` and the
   * injected Sideboard MCP omits them (see docs/system/agent-rpc.md).
   * Orchestration also registers wait_for_turn when {@link CursorTurnRequest.rpcWaitForTurn}.
   */
  agentRpc?: AgentRpcConnect | null;
  /**
   * Orchestration Cursor: expose `wait_for_turn` as a native RPC tool.
   * Worktree turns leave this unset so the model does not see fleet wait.
   */
  rpcWaitForTurn?: boolean;
  /**
   * Inline MCP servers for this turn (Sideboard / Brightsy).
   * Must be passed on create and resume — Cursor does not persist them.
   */
  mcpServers?: Record<
    string,
    {
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
};
