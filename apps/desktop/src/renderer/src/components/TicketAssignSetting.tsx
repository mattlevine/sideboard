import type { PublicAppSettings, ScheduledTask } from '@sideboard-ai/core';

export function TicketAssignSetting(props: {
  on: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  applySettings: (settings: PublicAppSettings) => void;
}) {
  async function toggle() {
    const next = !props.on;
    props.setBusy(true);
    props.setError(null);
    try {
      const saved = await window.sideboard.updateAdvancedSettings({
        ticketAssignOpensWorkspace: next,
      });
      props.applySettings(saved);
      const rows = (await window.sideboard.listSchedules()) as ScheduledTask[];
      const mine = rows.filter((row) => row.when.kind === 'ticket-assigned');
      if (next) {
        if (mine.length === 0) {
          await window.sideboard.createSchedule({
            name: 'Ticket assigned',
            prompt: '',
            when: { kind: 'ticket-assigned' },
            planMode: false,
            enabled: true,
            archiveChat: false,
          });
        } else {
          for (const row of mine) {
            if (!row.enabled) await window.sideboard.updateSchedule(row.id, { enabled: true });
          }
        }
      } else {
        for (const row of mine) {
          if (row.enabled) await window.sideboard.updateSchedule(row.id, { enabled: false });
        }
      }
    } catch (err) {
      props.setError(err instanceof Error ? err.message : String(err));
    } finally {
      props.setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-toggle-row">
        <div>
          <div className="settings-section-title">
            When a ticket is assigned to me, open a workspace
          </div>
          <p className="settings-hint">
            Polls Linear and GitHub for issues newly assigned to you. The first check after you
            turn this on, and the first check after Sideboard launches, only records what is
            already assigned. Turning it off and back on records again, including tickets assigned
            while it was off. A new assignment opens a workspace the same way as choosing that
            issue and leaving the prompt empty. The first turn is “Resolve this issue.” It does
            not merge. Sideboard must be running. Type a prompt under Automations to send that
            instead.
          </p>
        </div>
        <button
          type="button"
          className={`settings-switch${props.on ? ' on' : ''}`}
          role="switch"
          aria-checked={props.on}
          aria-label="When a ticket is assigned to me, open a workspace"
          disabled={props.busy}
          onClick={() => void toggle()}
        >
          <span className="settings-switch-knob" />
        </button>
      </div>
    </div>
  );
}
