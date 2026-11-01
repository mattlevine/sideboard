/**
 * Why an agent is waiting on a person. Process liveness stays on
 * `ThreadStatus`; this is the attention flag (Herdr `blocked`).
 * Cleared when the next user message starts a turn. An ask_user highlight
 * stays until the user answers or skips. A later tool in the same turn
 * does not remove it — the tool returns immediately, and the model often
 * keeps going before the person can answer.
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
  /** ask_user question-set signature, so a skip can drop this highlight. */
  questionSignature?: string;
  /**
   * Full ask_user payload. The composer reads this when the transcript
   * tool call never stored its input, so the sidebar highlight and the
   * chat picker stay the same question.
   */
  questions?: Array<{
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: Array<{ label: string; description?: string }>;
  }>;
  /**
   * True once ask_user is in the live stream or the finished turn.
   * A mid-turn stamp without this stays off the sidebar / board / phone
   * until the picker is actually on screen. A later tool does not clear it.
   */
  onScreen?: boolean;
  permission?: AgentPermissionPrompt;
}
