/**
 * Why an agent is waiting on a person. Process liveness stays on
 * `ThreadStatus`; this is the attention flag (Herdr `blocked`).
 * Cleared when the next user message starts a turn.
 */
export type AgentBlockSource = 'ask_user' | 'plan' | 'reported' | 'permission';

/** Composer Allow / Deny while a tool waits on the user. */
export interface AgentPermissionPrompt {
  id: string;
  title: string;
  detail: string;
  path?: string;
  /** Offer a remembered allow (a directory, or every tool on an MCP server). */
  allowSession: boolean;
  /** Button label when it is not "Allow for this session". */
  sessionLabel?: string;
  /** Claude asked that a stray keystroke must not approve this. */
  defaultToNo?: boolean;
}

export interface AgentBlock {
  /** Short reason shown on the sidebar, board, and to orchestrators. */
  reason: string;
  source: AgentBlockSource;
  at: string;
  permission?: AgentPermissionPrompt;
}
