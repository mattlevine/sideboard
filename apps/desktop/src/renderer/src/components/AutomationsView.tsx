import { SchedulesSettings } from './SchedulesSettings';
import { SidebarToggle } from './SidebarToggle';

export function AutomationsView({
  leftSidebarOpen,
  onToggleLeftSidebar,
}: {
  leftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
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
              awake until due. A sleeping Mac skips until wake.
            </span>
          </button>
        </div>
      </div>
      <SchedulesSettings />
    </section>
  );
}
