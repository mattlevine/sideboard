import type { AgentRpcConnect } from '../agent-rpc/metadata.js';

export type ClaudeTurnRequest = {
  prompt: string;
  cwd: string;
  sessionId?: string | null;
  model?: string | null;
  effort?: string | null;
  permissionMode: string;
  systemPrompt?: string;
  claudePath: string;
  chrome?: boolean;
  mcpServers: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
  allowedTools: string[];
  agentRpc: AgentRpcConnect;
  isolateClaudeAiMcp?: boolean;
};
