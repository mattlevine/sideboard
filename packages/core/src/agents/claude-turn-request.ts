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
  mcpServers: Record<string, Record<string, unknown>>;
  allowedTools: string[];
  agentRpc: AgentRpcConnect;
  isolateClaudeAiMcp?: boolean;
};
