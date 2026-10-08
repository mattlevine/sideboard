/**
 * Why an agent is waiting on a person. Process liveness stays on
 * `ThreadStatus`; this is the attention flag (Herdr `blocked`).
 * Cleared when the next user message starts a turn.
 */
export type AgentBlockSource = 'ask_user' | 'plan' | 'reported';

export interface AgentBlock {
  /** Short reason shown on the sidebar, board, and to orchestrators. */
  reason: string;
  source: AgentBlockSource;
  at: string;
}
