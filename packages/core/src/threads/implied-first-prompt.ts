/**
 * When a user creates a worktree from a ticket and does not type extra
 * instructions, treat that as “resolve this issue” and start the first turn.
 *
 * Orchestration children (`parentThreadId`) still wait for `send_to_thread`.
 * Reused live worktrees with existing chat history are not nudged again.
 */

export const IMPLIED_TICKET_RESOLVE_PROMPT = 'Resolve this issue.';

export function resolveCreateFirstPrompt(input: {
  sourceType: string;
  prompt?: string | null;
  parentThreadId?: string | null;
  reused?: boolean;
  hasUserMessages?: boolean;
}): string | undefined {
  const typed = input.prompt?.trim();
  if (typed) return typed;
  if (input.sourceType !== 'ticket') return undefined;
  if (input.parentThreadId) return undefined;
  if (input.reused && input.hasUserMessages) return undefined;
  return IMPLIED_TICKET_RESOLVE_PROMPT;
}
