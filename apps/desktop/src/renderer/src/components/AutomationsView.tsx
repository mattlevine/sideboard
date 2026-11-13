import type { ScheduleThisRequest } from './SchedulesSettings';
import { SchedulesSettings } from './SchedulesSettings';
import { SidebarToggle } from './SidebarToggle';

export function AutomationsView({
  leftSidebarOpen,
  onToggleLeftSidebar,
  scheduleRequest,
  onScheduleRequestConsumed,
  onOpenThread,
}: {
  leftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
  scheduleRequest?: ScheduleThisRequest | null;
  onScheduleRequestConsumed?: () => void;
  onOpenThread?: (threadId: string) => Promise<void> | void;
}) {
  return (
    <section className="panel board automations-panel">
      {!leftSidebarOpen && (
        <div className="board-chrome">
          <SidebarToggle side="left" open={false} onClick={onToggleLeftSidebar} />
          <div className="board-chrome-spacer" />
        </div>
      )}
      <div className="panel-header">
        <div className="automations-heading">
          <h2>Automations</h2>
          <button
            type="button"
            className="automations-help"
            aria-label="About automations"
            aria-describedby="automations-help-tip"
          >
            ?
            <span id="automations-help-tip" className="automations-help-tip" role="tooltip">
              Jobs that send a prompt to a chat (Global orchestration or a worktree), or start a new
              Global chat. Sideboard must be running. Creating or enabling a future job turns on
              Settings → Advanced → Caffeinate while automations are enabled so the Mac can stay
              awake until due. A sleeping Mac waits until wake, so a quiet stretch is not a failed
              run. Each automation lists its last 10 runs. History still keeps the last 5 archived
              chats.
            </span>
          </button>
        </div>
      </div>
      <SchedulesSettings
        scheduleRequest={scheduleRequest}
        onScheduleRequestConsumed={onScheduleRequestConsumed}
        onOpenThread={onOpenThread}
      />
    </section>
  );
}
