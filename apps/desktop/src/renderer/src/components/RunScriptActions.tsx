import type { RefObject } from 'react';
import { RunScriptIcon, scriptDisplayName } from '../lib/run-script-icons';
import { runMenuActionLabel } from '../lib/run-script-stop';

export interface RunScriptMenuItem {
  name: string;
  command: string;
  default?: boolean;
  icon?: string;
}

interface ActiveRunRef {
  scriptName: string;
  port: number;
}

interface Props {
  menuRef: RefObject<HTMLDivElement | null>;
  lower: 'setup' | 'run' | 'terminal';
  terminalSplit: boolean;
  onToggleTerminalSplit: () => void;
  primaryPort: number | null;
  extraStopScripts: string[];
  primaryRunning: boolean;
  primaryScriptName: string | null;
  hasHook: boolean;
  runScripts: RunScriptMenuItem[];
  defaultRunScript: RunScriptMenuItem | null;
  activeRuns: ActiveRunRef[];
  runMenuOpen: boolean;
  onReloadRunScripts: () => void;
  onToggleRunMenu: () => void;
  onCloseRunMenu: () => void;
  onToggleDev: () => void;
  onToggleNamedScript: (name: string) => void;
  onOpenRunConfig: () => void;
}

/** Run-tab Open / Stop / Dev controls. Lives outside RightSidebar so that file can shrink. */
export function RunScriptActions({
  menuRef,
  lower,
  terminalSplit,
  onToggleTerminalSplit,
  primaryPort,
  extraStopScripts,
  primaryRunning,
  primaryScriptName,
  hasHook,
  runScripts,
  defaultRunScript,
  activeRuns,
  runMenuOpen,
  onReloadRunScripts,
  onToggleRunMenu,
  onCloseRunMenu,
  onToggleDev,
  onToggleNamedScript,
  onOpenRunConfig,
}: Props) {
  return (
    <div className="lower-tab-actions" ref={menuRef}>
      {lower === 'terminal' ? (
        <button
          type="button"
          className={`dev-open-port${terminalSplit ? ' is-live' : ''}`}
          title={terminalSplit ? 'Merge terminal panes' : 'Split terminal'}
          aria-pressed={terminalSplit}
          onClick={onToggleTerminalSplit}
        >
          Split
        </button>
      ) : null}
      {/* Conductor: Open is pinned with Stop/Dev, not in the scrolling tabs. */}
      {lower === 'run' && primaryPort != null ? (
        <button
          type="button"
          className="dev-open-port"
          title={`Open http://localhost:${primaryPort} in your default browser`}
          onClick={() => {
            void window.sideboard.openExternal(`http://localhost:${primaryPort}`);
          }}
        >
          <RunScriptIcon name="globe" />
          <span>{`Open :${primaryPort}`}</span>
        </button>
      ) : null}
      {extraStopScripts.map((name) => (
        <button
          key={name}
          type="button"
          className="dev-stop-btn"
          title={`Stop ${scriptDisplayName(name)}`}
          onClick={() => {
            onCloseRunMenu();
            onToggleNamedScript(name);
          }}
        >
          <RunScriptIcon name="stop" />
          <span>Stop {scriptDisplayName(name)}</span>
        </button>
      ))}
      <div className="dev-composite-group">
        {primaryRunning ? (
          <button
            type="button"
            className="dev-composite"
            title={`Stop ${scriptDisplayName(primaryScriptName ?? 'Dev')} (⌘R). Other run scripts keep going.`}
            onClick={() => {
              onCloseRunMenu();
              onToggleDev();
            }}
          >
            <RunScriptIcon name="stop" />
            <span>
              {(activeRuns.length ?? 0) > 1 && primaryScriptName
                ? `Stop ${scriptDisplayName(primaryScriptName)}`
                : 'Stop'}
            </span>
            <kbd>⌘R</kbd>
          </button>
        ) : (
          <button
            type="button"
            className="dev-composite"
            disabled={!hasHook && runScripts.length === 0}
            title={
              defaultRunScript
                ? `Start ${scriptDisplayName(defaultRunScript.name)} (⌘R)`
                : 'Configure run scripts'
            }
            onClick={() => {
              onCloseRunMenu();
              onToggleDev();
            }}
          >
            <RunScriptIcon name={defaultRunScript?.icon ?? 'play'} />
            <span>
              {defaultRunScript ? scriptDisplayName(defaultRunScript.name) : 'Dev'}
            </span>
            <kbd>⌘R</kbd>
          </button>
        )}
        <button
          type="button"
          className={`dev-script-chevron${runMenuOpen ? ' open' : ''}`}
          title="Run scripts — several can stay up together"
          aria-haspopup="menu"
          aria-expanded={runMenuOpen}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onReloadRunScripts();
            onToggleRunMenu();
          }}
        >
          ▾
        </button>
      </div>

      {runMenuOpen ? (
        <ul className="dev-script-dropdown" role="menu">
          {runScripts.length === 0 ? (
            <li className="dev-script-empty">No run scripts configured</li>
          ) : (
            runScripts.map((script) => {
              const active = activeRuns.some((r) => r.scriptName === script.name);
              return (
                <li key={script.name} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={active ? 'active' : ''}
                    title={
                      active
                        ? `Stop ${scriptDisplayName(script.name)}`
                        : `Start ${scriptDisplayName(script.name)}`
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onCloseRunMenu();
                      onToggleNamedScript(script.name);
                    }}
                  >
                    <RunScriptIcon name={active ? 'stop' : script.icon ?? 'play'} />
                    <span>{runMenuActionLabel(script.name, active)}</span>
                    {active ? (
                      <span className="dev-script-port">
                        :{activeRuns.find((r) => r.scriptName === script.name)?.port}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
          <li className="dev-script-sep" aria-hidden />
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCloseRunMenu();
                onOpenRunConfig();
              }}
            >
              <RunScriptIcon name="settings" />
              <span>Configure</span>
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
