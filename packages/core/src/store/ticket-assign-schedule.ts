import { ticketAssignOpensWorkspaceEnabled, updateAdvancedSettings } from './app-settings.js';
import type { ScheduleWhen } from './schedule-when.js';

export function scheduleDisplayName(
  name: string | undefined,
  prompt: string,
  when: ScheduleWhen,
  fallback: (prompt: string) => string,
): string {
  const named = name?.trim();
  if (named) return named;
  if (!prompt.trim() && when.kind === 'ticket-assigned') return 'Ticket assigned';
  return fallback(prompt);
}

/** Keep the Advanced switch aligned with whether any ticket automation is polling. */
export function syncTicketAssignSwitch(
  rows: { when: ScheduleWhen; enabled: boolean }[],
): void {
  const on = rows.some((row) => row.when.kind === 'ticket-assigned' && row.enabled);
  if (ticketAssignOpensWorkspaceEnabled() === on) return;
  updateAdvancedSettings({ ticketAssignOpensWorkspace: on });
}
