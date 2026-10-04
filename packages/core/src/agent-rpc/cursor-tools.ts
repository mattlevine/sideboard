import type { AgentRpcConnect } from './metadata.js';
import {
  createPilotRpcExecutors,
  PILOT_TOOL_DESCRIPTIONS,
  PILOT_TOOL_SCHEMAS,
  WAIT_FOR_TURN_DESCRIPTION,
  WAIT_FOR_TURN_SCHEMA,
  type PilotToolContext,
} from './pilot-tools.js';

export type SideboardCursorRpcTool = {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context?: PilotToolContext,
  ) => Promise<string>;
};

export type SideboardCursorRpcToolsOptions = {
  /** Worktree the agent runs in; job methods resolve `.context/jobs` here, not in the desktop cwd. */
  cwd: string;
  rpc: AgentRpcConnect;
  /**
   * Called for every `runtime.progress` notification while a job or turn wait
   * is held. The Cursor runner uses it to keep its stream-idle guard from
   * ending the turn and to push a partial tool result so the log pane updates.
   */
  onProgress?: (params: unknown, toolCallId?: string) => void;
  /** Orchestration Cursor: register `wait_for_turn` as a native tool. */
  includeWaitForTurn?: boolean;
};

export function sideboardCursorRpcTools(
  opts: SideboardCursorRpcToolsOptions,
): Record<string, SideboardCursorRpcTool> {
  const exec = createPilotRpcExecutors(opts);
  const tools: Record<string, SideboardCursorRpcTool> = {
    present_artifact: {
      description: PILOT_TOOL_DESCRIPTIONS.present_artifact,
      inputSchema: PILOT_TOOL_SCHEMAS.present_artifact,
      execute: exec.present_artifact,
    },
    wait_for_job: {
      description: PILOT_TOOL_DESCRIPTIONS.wait_for_job,
      inputSchema: PILOT_TOOL_SCHEMAS.wait_for_job,
      execute: exec.wait_for_job,
    },
    stop_job: {
      description: PILOT_TOOL_DESCRIPTIONS.stop_job,
      inputSchema: PILOT_TOOL_SCHEMAS.stop_job,
      execute: exec.stop_job,
    },
  };
  if (opts.includeWaitForTurn) {
    tools.wait_for_turn = {
      description: WAIT_FOR_TURN_DESCRIPTION,
      inputSchema: WAIT_FOR_TURN_SCHEMA,
      execute: exec.wait_for_turn,
    };
  }
  return tools;
}
