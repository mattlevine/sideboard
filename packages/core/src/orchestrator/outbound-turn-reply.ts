import type { TaskState } from './task-state.js';

/**
 * Slice of {@link Orchestrator.getTurnResult} that outbound adapters
 * (Brightsy cloud connect, Slack Listen) need to decide what to post.
 * Those paths block on waitForTurn, then treat the result as a finished
 * reply — they must not post ask_user picker text as a successful answer.
 */
export type OutboundTurnSnapshot = {
  text: string;
  status: string;
  taskState: TaskState;
  lastError?: string | null;
};

export type OutboundTurnCopy = {
  /** Mac-side ask_user — picker is not on the remote channel. */
  inputRequired: string;
  /** Force-stopped before a finished answer. */
  canceled: string;
  /** Runner/agent error. `detail` is lastError or leftover text (may be empty). */
  failed: (detail: string) => string;
  /** Completed with empty assistant text. */
  completedEmpty: (status: string) => string;
};

/**
 * Map a finished waitForTurn snapshot to the string an outbound adapter posts.
 * Never returns the raw ask_user prompt for `input-required`.
 */
export function outboundReplyFromTurn(
  result: OutboundTurnSnapshot,
  copy: OutboundTurnCopy,
): string {
  switch (result.taskState) {
    case 'input-required':
      return copy.inputRequired;
    case 'canceled':
      return copy.canceled;
    case 'failed': {
      const detail = (result.lastError ?? result.text).trim();
      return copy.failed(detail);
    }
    case 'submitted':
    case 'working':
      return copy.failed(`turn still ${result.taskState}`);
    default: {
      const text = result.text.trim();
      return text || copy.completedEmpty(result.status);
    }
  }
}
