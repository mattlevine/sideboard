/**
 * Plan prompt for a workspace opened because a ticket was assigned.
 * It is not a git-button phrase, and it cannot merge.
 * Kept out of schedules.ts so the desktop renderer can import it without Node deps.
 */
export const TICKET_ASSIGN_PLAN_PROMPT =
  'Plan this ticket. Write the plan in this workspace. Do not implement it, do not open a pull request, and do not merge.';
