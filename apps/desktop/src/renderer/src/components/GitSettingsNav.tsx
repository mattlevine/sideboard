import type { GitSettingsPanel } from './GitSettings';

const HOSTS: { id: GitSettingsPanel; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'entire', label: 'Entire' },
];

export function GitSettingsNav({
  active,
  panel,
  ready,
  onOpenList,
  onOpenPanel,
}: {
  active: boolean;
  panel: GitSettingsPanel | null;
  ready: { github: boolean; cursor: boolean; entire: boolean };
  onOpenList: () => void;
  onOpenPanel: (panel: GitSettingsPanel) => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`settings-nav-btn${active && !panel ? ' active' : ''}`}
        onClick={onOpenList}
      >
        Git
      </button>
      {active ? (
        <div className="settings-nav-sub">
          {HOSTS.map((host) => (
            <button
              key={host.id}
              type="button"
              className={`settings-nav-sub-btn${panel === host.id ? ' active' : ''}`}
              onClick={() => onOpenPanel(host.id)}
            >
              <span>{host.label}</span>
              <span className={`settings-dot${ready[host.id] ? ' ok' : ''}`} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
