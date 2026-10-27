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
        <h2>Automations</h2>
      </div>
      <SchedulesSettings />
    </section>
  );
}
