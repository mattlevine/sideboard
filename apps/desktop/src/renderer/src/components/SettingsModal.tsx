import { useEffect, useMemo, useState } from 'react';
import type {
  AgentStatus,
  AppSettings,
  BrightsyCloudConnectAgent,
  BrightsySession,
  CloudConnectStatus,
} from '@sideboard/core';

type NavId = 'agents' | 'environment';
type AgentPanel = 'claude' | 'codex' | 'opencode' | 'cursor' | 'brightsy';

const CLOUD_CONNECT_AGENTS: Array<{ id: BrightsyCloudConnectAgent; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
];

interface Props {
  onClose: () => void;
}

const CLAUDE_CHROME_DOCS = 'https://code.claude.com/docs/en/chrome';
const CLAUDE_CHROME_EXTENSION =
  'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn';

const AGENT_PANELS: Array<{
  id: AgentPanel;
  label: string;
  envKey: string | null;
  blurb: string;
  docsUrl: string;
}> = [
  {
    id: 'claude',
    label: 'Claude Code',
    envKey: 'ANTHROPIC_API_KEY',
    blurb: 'Uses the Claude CLI on your PATH, or ANTHROPIC_API_KEY for API billing.',
    docsUrl: 'https://code.claude.com/docs/en/install',
  },
  {
    id: 'codex',
    label: 'Codex',
    envKey: 'CODEX_API_KEY',
    blurb: 'Uses the Codex CLI on your PATH, or CODEX_API_KEY for API auth.',
    docsUrl: 'https://github.com/openai/codex',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    envKey: null,
    blurb: 'Uses the OpenCode CLI. Provider API keys are managed via OpenCode auth or Environment.',
    docsUrl: 'https://opencode.ai/docs',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    envKey: 'CURSOR_API_KEY',
    blurb:
      'Runs through the Cursor API (same as Conductor). There is no local Cursor executable to configure.',
    docsUrl: 'https://cursor.com/dashboard/integrations',
  },
  {
    id: 'brightsy',
    label: 'Brightsy',
    envKey: null,
    blurb:
      'Hosted chat via the Brightsy CLI (`brightsy login`). Connect teams below, then turn on Cloud messages so remote Brightsy agents (Slack, Discord, Teams) can ask about all Sideboard workspaces.',
    docsUrl: 'https://www.npmjs.com/package/@brightsy/cli',
  },
];

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function statusFor(statuses: AgentStatus[], id: AgentPanel): AgentStatus | undefined {
  return statuses.find((s) => s.agent === id);
}

export function SettingsModal({ onClose }: Props) {
  const [nav, setNav] = useState<NavId>('agents');
  const [agentPanel, setAgentPanel] = useState<AgentPanel | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    environment: {},
    claude: {},
    brightsy: {},
  });
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [claudePathDraft, setClaudePathDraft] = useState('');
  const [systemClaudePath, setSystemClaudePath] = useState<string | null>(null);
  const [brightsySession, setBrightsySession] = useState<BrightsySession | null>(null);
  const [cloudConnect, setCloudConnect] = useState<CloudConnectStatus | null>(null);

  async function reload() {
    const cloudApi = window.sideboard.getCloudConnectStatus;
    const [s, agents, systemPath, session, cloud] = await Promise.all([
      window.sideboard.getAppSettings(),
      window.sideboard.detectAgents(),
      window.sideboard.resolveSystemClaudePath(),
      window.sideboard.getBrightsySession().catch(() => null),
      typeof cloudApi === 'function'
        ? cloudApi().catch(() => null)
        : Promise.resolve(null),
    ]);
    setSettings({
      environment: s.environment ?? {},
      claude: s.claude ?? {},
      brightsy: s.brightsy ?? {},
    });
    setStatuses(agents);
    setSystemClaudePath(systemPath);
    setClaudePathDraft(s.claude?.executablePath ?? '');
    setBrightsySession(session);
    setCloudConnect(cloud);
  }

  useEffect(() => {
    void reload().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  useEffect(() => {
    if (agentPanel !== 'brightsy') return;
    const cloudApi = window.sideboard.getCloudConnectStatus;
    if (typeof cloudApi !== 'function') return;
    const id = window.setInterval(() => {
      void cloudApi()
        .then(setCloudConnect)
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [agentPanel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const envEntries = useMemo(
    () => Object.entries(settings.environment).sort(([a], [b]) => a.localeCompare(b)),
    [settings.environment],
  );

  const activeAgent = agentPanel
    ? AGENT_PANELS.find((a) => a.id === agentPanel) ?? null
    : null;
  const activeStatus = agentPanel ? statusFor(statuses, agentPanel) : undefined;
  const activeEnvValue =
    activeAgent?.envKey != null ? settings.environment[activeAgent.envKey] ?? '' : '';

  async function saveEnvPatch(patch: Record<string, string | null>) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateAppEnvironment(patch);
      setSettings({
        environment: next.environment ?? {},
        claude: next.claude ?? {},
        brightsy: next.brightsy ?? {},
      });
      const agents = await window.sideboard.detectAgents();
      setStatuses(agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveClaudePatch(patch: {
    executablePath?: string | null;
    chromeEnabled?: boolean;
  }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateClaudeSettings(patch);
      setSettings({
        environment: next.environment ?? {},
        claude: next.claude ?? {},
        brightsy: next.brightsy ?? {},
      });
      setClaudePathDraft(next.claude?.executablePath ?? '');
      const agents = await window.sideboard.detectAgents();
      setStatuses(agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCloudConnect(opts: {
    enabled?: boolean;
    agent?: BrightsyCloudConnectAgent;
  }) {
    setBusy(true);
    setError(null);
    try {
      if (typeof window.sideboard.setCloudConnect !== 'function') {
        throw new Error(
          'Cloud connect requires a desktop restart (preload bridge outdated). Quit and reopen Sideboard.',
        );
      }
      const status = await window.sideboard.setCloudConnect(opts);
      setCloudConnect(status);
      const next = await window.sideboard.getAppSettings();
      setSettings({
        environment: next.environment ?? {},
        claude: next.claude ?? {},
        brightsy: next.brightsy ?? {},
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title" id="settings-title">
              Settings
            </div>
            <button
              type="button"
              className={`settings-nav-btn${nav === 'agents' && !agentPanel ? ' active' : ''}`}
              onClick={() => {
                setNav('agents');
                setAgentPanel(null);
              }}
            >
              Agents
            </button>
            {nav === 'agents' && (
              <div className="settings-nav-sub">
                {AGENT_PANELS.map((a) => {
                  const st = statusFor(statuses, a.id);
                  const ready = Boolean(st?.installed && st.authenticated);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`settings-nav-sub-btn${agentPanel === a.id ? ' active' : ''}`}
                      onClick={() => {
                        setNav('agents');
                        setAgentPanel(a.id);
                        setShowSecret(false);
                      }}
                    >
                      <span>{a.label}</span>
                      <span className={`settings-dot${ready ? ' ok' : ''}`} />
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className={`settings-nav-btn${nav === 'environment' ? ' active' : ''}`}
              onClick={() => {
                setNav('environment');
                setAgentPanel(null);
              }}
            >
              Environment
            </button>
          </aside>

          <div className="settings-main">
            <div className="settings-main-header">
              <h3>
                {nav === 'environment'
                  ? 'Environment'
                  : activeAgent
                    ? activeAgent.label
                    : 'Agents'}
              </h3>
              <button type="button" className="icon-btn" title="Close" onClick={onClose}>
                ✕
              </button>
            </div>

            {error && <div className="settings-error">{error}</div>}

            {nav === 'agents' && !activeAgent && (
              <div className="settings-body">
                <p className="settings-lead">
                  Configure agent harnesses the way Conductor does. Credentials set here also appear
                  under Environment and are injected into agent runs.
                </p>
                <div className="settings-agent-list">
                  {AGENT_PANELS.map((a) => {
                    const st = statusFor(statuses, a.id);
                    const ready = Boolean(st?.installed && st.authenticated);
                    const connectedCount =
                      a.id === 'brightsy'
                        ? (brightsySession?.connectedTeams ?? []).length
                        : 0;
                    const cloudBit =
                      a.id === 'brightsy' && cloudConnect?.enabled
                        ? cloudConnect.running
                          ? ' · cloud on'
                          : ' · cloud enabled'
                        : '';
                    const meta =
                      a.id === 'brightsy' && ready
                        ? connectedCount > 0
                          ? `Ready · ${connectedCount} team${connectedCount === 1 ? '' : 's'} connected${cloudBit}`
                          : `Ready · select teams to connect${cloudBit}`
                        : ready
                          ? 'Ready'
                          : st?.reason || (st?.installed ? 'Needs auth' : 'Not installed');
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="settings-agent-row"
                        onClick={() => {
                          setAgentPanel(a.id);
                          setShowSecret(false);
                        }}
                      >
                        <div>
                          <div className="settings-agent-name">{a.label}</div>
                          <div className="settings-agent-meta">{meta}</div>
                        </div>
                        <span className={`settings-dot${ready ? ' ok' : ''}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {nav === 'agents' && activeAgent && (
              <div className="settings-body">
                <p className="settings-lead">{activeAgent.blurb}</p>
                <div className="settings-status-card">
                  <div>
                    <div className="settings-label">Status</div>
                    <div className="settings-status-text">
                      {activeStatus?.installed && activeStatus.authenticated
                        ? 'Authenticated'
                        : activeStatus?.reason || 'Not ready'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reload()}
                  >
                    Refresh
                  </button>
                </div>

                {activeAgent.id === 'claude' && (
                  <>
                    <div className="settings-section">
                      <div className="settings-toggle-row">
                        <div>
                          <div className="settings-section-title">Use Claude Code with Chrome</div>
                          <p className="settings-hint">
                            Allow Claude Code to control your Chrome browser. Install the{' '}
                            <button
                              type="button"
                              className="settings-link"
                              onClick={() => void window.sideboard.openExternal(CLAUDE_CHROME_EXTENSION)}
                            >
                              Claude in Chrome extension
                            </button>{' '}
                            first.{' '}
                            <button
                              type="button"
                              className="settings-link"
                              onClick={() => void window.sideboard.openExternal(CLAUDE_CHROME_DOCS)}
                            >
                              View the docs
                            </button>
                            .
                          </p>
                        </div>
                        <button
                          type="button"
                          className={`settings-switch${settings.claude?.chromeEnabled ? ' on' : ''}`}
                          role="switch"
                          aria-checked={Boolean(settings.claude?.chromeEnabled)}
                          disabled={busy}
                          onClick={() =>
                            void saveClaudePatch({
                              chromeEnabled: !settings.claude?.chromeEnabled,
                            })
                          }
                        >
                          <span className="settings-switch-knob" />
                        </button>
                      </div>
                    </div>

                    <div className="settings-section">
                      <label className="settings-section-title" htmlFor="claude-executable-path">
                        Claude Code executable path
                      </label>
                      <p className="settings-hint">
                        Override the Claude Code executable. Leave empty to use the system{' '}
                        <code>claude</code>
                        {systemClaudePath ? ` (${systemClaudePath})` : ' on PATH'} (recommended).
                      </p>
                      <div className="settings-key-row">
                        <input
                          id="claude-executable-path"
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={systemClaudePath || 'claude'}
                          value={claudePathDraft}
                          onChange={(e) => setClaudePathDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          title="Browse"
                          disabled={busy}
                          onClick={() => {
                            void window.sideboard.pickClaudeExecutable().then((path) => {
                              if (!path) return;
                              setClaudePathDraft(path);
                              void saveClaudePatch({ executablePath: path });
                            });
                          }}
                        >
                          …
                        </button>
                      </div>
                      <div className="settings-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={
                            busy ||
                            claudePathDraft.trim() === (settings.claude?.executablePath ?? '')
                          }
                          onClick={() =>
                            void saveClaudePatch({
                              executablePath: claudePathDraft.trim() || null,
                            })
                          }
                        >
                          Save path
                        </button>
                        <button
                          type="button"
                          disabled={busy || !settings.claude?.executablePath}
                          onClick={() => void saveClaudePatch({ executablePath: null })}
                        >
                          Use system Claude Code
                        </button>
                      </div>
                    </div>

                    <div className="settings-section settings-section-card">
                      <div className="settings-claude-settings-row">
                        <div>
                          <div className="settings-section-title">Claude settings</div>
                          <code className="settings-path">~/.claude/settings.json</code>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void window.sideboard.openClaudeUserSettings().catch((err) =>
                              setError(err instanceof Error ? err.message : String(err)),
                            );
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {activeAgent.envKey && (
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="harness-api-key">
                      {activeAgent.envKey}
                    </label>
                    <div className="settings-key-row">
                      <input
                        id="harness-api-key"
                        type={showSecret ? 'text' : 'password'}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                          activeEnvValue
                            ? maskSecret(activeEnvValue)
                            : `Paste ${activeAgent.envKey}`
                        }
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        onFocus={() => {
                          if (!draftValue && activeEnvValue) setDraftValue(activeEnvValue);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        title={showSecret ? 'Hide' : 'Show'}
                      >
                        {showSecret ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || !draftValue.trim()}
                        onClick={() => {
                          void saveEnvPatch({
                            [activeAgent.envKey!]: draftValue.trim(),
                          }).then(() => setDraftValue(''));
                        }}
                      >
                        Save key
                      </button>
                      {activeEnvValue && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void saveEnvPatch({ [activeAgent.envKey!]: null }).then(() =>
                              setDraftValue(''),
                            );
                          }}
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void window.sideboard.openExternal(activeAgent.docsUrl)}
                      >
                        Get API key
                      </button>
                    </div>
                    <p className="settings-hint">
                      Saving updates Settings → Environment. Shell env vars still take precedence
                      when already set.
                    </p>
                  </div>
                )}

                {(activeAgent.id === 'brightsy' || activeAgent.id === 'claude') && (
                  <div className="settings-section">
                    <div className="settings-section-title">Brightsy teams</div>
                    <p className="settings-hint">
                      Uses <code>brightsy teams</code> / <code>switch</code> (same as MCP{' '}
                      <code>list_teams</code> / <code>switch_team</code>). Connected teams drive
                      Brightsy CLI, agent chat, and Claude MCP (
                      <code>brightsy_&lt;slug&gt;</code> per team).
                    </p>
                    {!brightsySession?.connected ? (
                      <p className="settings-hint">
                        {brightsySession?.reason || 'Not logged in — run `brightsy login`.'}
                      </p>
                    ) : (
                      <>
                        <div className="settings-check-list">
                          {brightsySession.accounts.map((account) => {
                            const connected = (brightsySession.connectedTeams ?? []).some(
                              (t) => t.id === account.id,
                            );
                            const active = account.id === brightsySession.accountId;
                            const setTeam = (next: boolean) => {
                              setBusy(true);
                              setError(null);
                              void (
                                next
                                  ? window.sideboard.connectBrightsyTeam(account.id)
                                  : window.sideboard.disconnectBrightsyTeam(account.id)
                              )
                                .then((session) => {
                                  setBrightsySession(session);
                                  return window.sideboard.detectAgents();
                                })
                                .then((agents) => setStatuses(agents))
                                .catch((err) =>
                                  setError(err instanceof Error ? err.message : String(err)),
                                )
                                .finally(() => setBusy(false));
                            };
                            return (
                              <label key={account.id} className="settings-check-row">
                                <input
                                  type="checkbox"
                                  disabled={busy}
                                  checked={connected}
                                  onChange={(e) => setTeam(e.target.checked)}
                                />
                                <span>
                                  {account.name}
                                  {account.slug ? (
                                    <span className="settings-hint"> @{account.slug}</span>
                                  ) : null}
                                  {account.is_personal_account ? (
                                    <span className="settings-hint"> · personal</span>
                                  ) : null}
                                  {connected && active ? (
                                    <span className="settings-hint"> · active</span>
                                  ) : null}
                                  {connected && !active ? (
                                    <>
                                      {' '}
                                      <button
                                        type="button"
                                        className="settings-inline-btn"
                                        disabled={busy}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setTeam(true);
                                        }}
                                      >
                                        Make active
                                      </button>
                                    </>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="settings-hint">
                          {(brightsySession.connectedTeams ?? []).length === 0
                            ? 'Select at least one team to use Brightsy from agents.'
                            : `${(brightsySession.connectedTeams ?? []).length} connected · active ${brightsySession.accountSlug || brightsySession.accountId} · ${brightsySession.endpoint}`}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {activeAgent.id === 'brightsy' && (
                  <div className="settings-section">
                    <div className="settings-toggle-row">
                      <div>
                        <div className="settings-section-title">
                          Cloud messages / remote orchestrator
                        </div>
                        <p className="settings-hint">
                          Let Brightsy cloud agents ask about and drive threads across all
                          registered Sideboard workspaces — via Slack, Discord, or Microsoft Teams
                          (Slack is the best-tested path). Requires <code>brightsy login</code> and
                          a chat channel connected on the Brightsy agent.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`settings-switch${cloudConnect?.enabled ? ' on' : ''}`}
                        role="switch"
                        aria-checked={Boolean(cloudConnect?.enabled)}
                        disabled={busy || !brightsySession?.connected}
                        onClick={() =>
                          void saveCloudConnect({
                            enabled: !cloudConnect?.enabled,
                          })
                        }
                      >
                        <span className="settings-switch-knob" />
                      </button>
                    </div>

                    <label className="settings-label" htmlFor="cloud-connect-agent">
                      Coordinator agent
                    </label>
                    <select
                      id="cloud-connect-agent"
                      className="settings-select"
                      disabled={busy}
                      value={cloudConnect?.agent ?? settings.brightsy?.cloudConnectAgent ?? 'claude'}
                      onChange={(e) =>
                        void saveCloudConnect({
                          agent: e.target.value as BrightsyCloudConnectAgent,
                        })
                      }
                    >
                      {CLOUD_CONNECT_AGENTS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>

                    <p className="settings-hint" style={{ marginTop: '0.6rem' }}>
                      {cloudConnect?.enabled
                        ? cloudConnect.running
                          ? `Listening${cloudConnect.endpoint ? ` via ${cloudConnect.endpoint}` : ''} · ${cloudConnect.workspaces.length} workspace${cloudConnect.workspaces.length === 1 ? '' : 's'}`
                          : cloudConnect.lastError
                            ? `Enabled, but not running — ${cloudConnect.lastError}`
                            : 'Enabled — starting…'
                        : brightsySession?.connected
                          ? 'Off — turn on to accept Brightsy cloud tasks (Slack / Discord / Teams).'
                          : 'Log in with Brightsy first.'}
                    </p>
                    {cloudConnect?.enabled && cloudConnect.workspaces.length > 0 ? (
                      <ul className="settings-workspace-list">
                        {cloudConnect.workspaces.map((ws) => (
                          <li key={ws.path}>
                            <span>{ws.name}</span>
                            <code className="settings-path">{ws.path}</code>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {cloudConnect?.lastLog ? (
                      <p className="settings-hint settings-cloud-log">
                        {cloudConnect.lastLog}
                      </p>
                    ) : null}
                  </div>
                )}

                {!activeAgent.envKey &&
                  activeAgent.id !== 'brightsy' &&
                  activeAgent.id !== 'claude' && (
                  <p className="settings-hint">
                    Auth for this harness is handled by its CLI. Use Settings → Environment for any
                    extra provider keys.
                  </p>
                )}
              </div>
            )}

            {nav === 'environment' && (
              <div className="settings-body">
                <p className="settings-lead">
                  Environment variables injected into agent runs and hooks (for example{' '}
                  <code>CURSOR_API_KEY</code>). Keys added under Agents show up here too.
                </p>

                <div className="settings-env-table">
                  {envEntries.length === 0 && (
                    <div className="settings-empty">No environment variables yet.</div>
                  )}
                  {envEntries.map(([key, value]) => (
                    <div key={key} className="settings-env-row">
                      {editingEnvKey === key ? (
                        <>
                          <code className="settings-env-key">{key}</code>
                          <input
                            className="settings-env-input"
                            value={draftValue}
                            autoFocus
                            spellCheck={false}
                            onChange={(e) => setDraftValue(e.target.value)}
                          />
                          <button
                            type="button"
                            className="primary"
                            disabled={busy}
                            onClick={() => {
                              void saveEnvPatch({ [key]: draftValue }).then(() => {
                                setEditingEnvKey(null);
                                setDraftValue('');
                              });
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEnvKey(null);
                              setDraftValue('');
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <code className="settings-env-key">{key}</code>
                          <span className="settings-env-value" title={value}>
                            {maskSecret(value)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEnvKey(key);
                              setDraftValue(value);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveEnvPatch({ [key]: null })}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="settings-field">
                  <div className="settings-label">Add variable</div>
                  <div className="settings-key-row">
                    <input
                      placeholder="NAME"
                      spellCheck={false}
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value.toUpperCase())}
                    />
                    <input
                      placeholder="value"
                      spellCheck={false}
                      value={editingEnvKey ? '' : draftValue}
                      disabled={Boolean(editingEnvKey)}
                      onChange={(e) => setDraftValue(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || !draftKey.trim() || !draftValue.trim() || Boolean(editingEnvKey)}
                      onClick={() => {
                        const key = draftKey.trim();
                        const value = draftValue.trim();
                        void saveEnvPatch({ [key]: value }).then(() => {
                          setDraftKey('');
                          setDraftValue('');
                        });
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
