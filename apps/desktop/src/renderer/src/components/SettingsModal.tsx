import { useEffect, useMemo, useState } from 'react';
import type {
  AdvancedAppSettings,
  AgentKind,
  AgentSetupActionResult,
  AgentStatus,
  AppSettings,
  Autonomy,
  BrightsyCloudConnectAgent,
  BrightsySession,
  CloudConnectStatus,
  GitHubStatus,
  IssueSource,
  ThinkingEffort,
  Thread,
} from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import { parseThinkingEffort, thinkingEffortLabel } from './ThinkingEffortChip';

type NavId = 'account' | 'agents' | 'environment' | 'advanced' | 'history';
type AgentPanel = 'claude' | 'codex' | 'opencode' | 'cursor' | 'brightsy';

const CLOUD_CONNECT_AGENTS: Array<{ id: BrightsyCloudConnectAgent; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
];

const DEFAULT_AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  brightsy: 'Brightsy',
};

const CLAUDE_DEFAULT_MODEL_LABELS: Record<string, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

function defaultAgentModelLabel(
  agent: AgentKind,
  model: string | null,
  effort: ThinkingEffort,
): string {
  const agentLabel = DEFAULT_AGENT_LABELS[agent] ?? agent;
  const thinking = thinkingEffortLabel(effort);
  if (agent === 'claude') {
    if (!model) return `${agentLabel} · Auto · ${thinking}`;
    return `${agentLabel} · ${CLAUDE_DEFAULT_MODEL_LABELS[model] ?? model} · ${thinking}`;
  }
  if (agent === 'cursor') {
    const m = (model ?? '').trim().toLowerCase();
    if (!m || m === 'default' || m === 'auto') {
      return `${agentLabel} · Auto · ${thinking}`;
    }
    return `${agentLabel} · ${model} · ${thinking}`;
  }
  if (!model) return `${agentLabel} · Auto · ${thinking}`;
  return `${agentLabel} · ${model} · ${thinking}`;
}

interface Props {
  onClose: () => void;
  /** Initial sidebar section (e.g. Account from Create-from Linear setup). */
  initialNav?: NavId;
  /** Archived threads for Settings → History. */
  archived?: Thread[];
  onRestoreArchived?: (id: string) => void;
  onOpenArchived?: (id: string) => void;
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
  /** True when Sideboard embeds the runtime (no CLI package to install). */
  bundled?: boolean;
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
      'No CLI to install — Sideboard ships the Cursor SDK (same as Conductor). Add a CURSOR_API_KEY from the Cursor dashboard.',
    docsUrl: 'https://cursor.com/dashboard/integrations',
    bundled: true,
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

export function SettingsModal({
  onClose,
  initialNav = 'account',
  archived = [],
  onRestoreArchived,
  onOpenArchived,
}: Props) {
  const [nav, setNav] = useState<NavId>(initialNav);
  const [agentPanel, setAgentPanel] = useState<AgentPanel | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [settings, setSettings] = useState<AppSettings>({
    environment: {},
    claude: {},
    brightsy: {},
    integrations: {},
    defaults: {},
    advanced: {},
  });
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState('3');
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [claudePathDraft, setClaudePathDraft] = useState('');
  const [systemClaudePath, setSystemClaudePath] = useState<string | null>(null);
  const [brightsySession, setBrightsySession] = useState<BrightsySession | null>(null);
  const [cloudConnect, setCloudConnect] = useState<CloudConnectStatus | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [linearKeyDraft, setLinearKeyDraft] = useState('');
  const [showLinearKey, setShowLinearKey] = useState(false);
  const [defaultsPickerOpen, setDefaultsPickerOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState<'install' | 'login' | null>(null);
  const [setupLog, setSetupLog] = useState<string | null>(null);

  async function reload() {
    const cloudApi = window.sideboard.getCloudConnectStatus;
    const [s, agents, systemPath, session, cloud, gh] = await Promise.all([
      window.sideboard.getAppSettings(),
      window.sideboard.detectAgents(),
      window.sideboard.resolveSystemClaudePath(),
      window.sideboard.getBrightsySession().catch(() => null),
      typeof cloudApi === 'function'
        ? cloudApi().catch(() => null)
        : Promise.resolve(null),
      window.sideboard.getGitHubStatus().catch(() => null),
    ]);
    setSettings({
      environment: s.environment ?? {},
      claude: s.claude ?? {},
      brightsy: s.brightsy ?? {},
      integrations: s.integrations ?? {},
      defaults: s.defaults ?? {},
      advanced: s.advanced ?? {},
    });
    setMaxConcurrentDraft(String(s.advanced?.maxConcurrent ?? 3));
    setStatuses(agents);
    setSystemClaudePath(systemPath);
    setClaudePathDraft(s.claude?.executablePath ?? '');
    setBrightsySession(session);
    setCloudConnect(cloud);
    setGithubStatus(gh);
    setLinearKeyDraft('');
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
    setSetupLog(null);
    setSetupBusy(null);
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

  function formatSetupResult(result: AgentSetupActionResult): string {
    const parts = [result.message];
    if (result.stdout?.trim()) parts.push(result.stdout.trim());
    if (result.stderr?.trim()) parts.push(result.stderr.trim());
    return parts.filter(Boolean).join('\n\n');
  }

  async function runInstall() {
    if (!activeAgent || setupBusy) return;
    setSetupBusy('install');
    setSetupLog(null);
    setError(null);
    try {
      const result = await window.sideboard.installAgent(activeAgent.id);
      setSetupLog(formatSetupResult(result));
      if (!result.ok) setError(result.message);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSetupBusy(null);
    }
  }

  async function runLogin() {
    if (!activeAgent || setupBusy) return;
    setSetupBusy('login');
    setSetupLog(null);
    setError(null);
    try {
      const result = await window.sideboard.loginAgent(activeAgent.id);
      setSetupLog(formatSetupResult(result));
      if (!result.ok) setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSetupBusy(null);
    }
  }
  async function saveEnvPatch(patch: Record<string, string | null>) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateAppEnvironment(patch);
      setSettings({
        environment: next.environment ?? {},
        claude: next.claude ?? {},
        brightsy: next.brightsy ?? {},
        integrations: next.integrations ?? {},
        defaults: next.defaults ?? {},
        advanced: next.advanced ?? {},
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
        integrations: next.integrations ?? {},
        defaults: next.defaults ?? {},
        advanced: next.advanced ?? {},
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
        integrations: next.integrations ?? {},
        defaults: next.defaults ?? {},
        advanced: next.advanced ?? {},
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function applySettings(next: AppSettings) {
    setSettings({
      environment: next.environment ?? {},
      claude: next.claude ?? {},
      brightsy: next.brightsy ?? {},
      integrations: next.integrations ?? {},
      defaults: next.defaults ?? {},
      advanced: next.advanced ?? {},
    });
    setMaxConcurrentDraft(String(next.advanced?.maxConcurrent ?? 3));
  }

  async function saveIntegrationsPatch(patch: {
    linearApiKey?: string | null;
    issueSource?: IssueSource | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateIntegrationsSettings(patch);
      applySettings(next);
      setLinearKeyDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveDefaultsPatch(patch: {
    agent?: AgentKind | null;
    model?: string | null;
    effort?: ThinkingEffort | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateDefaultsSettings(patch);
      applySettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveAdvancedPatch(patch: Partial<AdvancedAppSettings>) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateAdvancedSettings(patch);
      applySettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const advanced = settings.advanced ?? {};
  const autoRenameOn = advanced.autoRenameBranch !== false;
  const defaultAgent: AgentKind = settings.defaults?.agent ?? 'claude';
  const defaultModel = settings.defaults?.model?.trim() || null;
  const defaultEffort: ThinkingEffort = parseThinkingEffort(settings.defaults?.effort);

  const filteredArchived = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    const list = [...archived].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return list;
    return list.filter((t) => {
      const repo = t.repoPath.split('/').filter(Boolean).pop() ?? t.repoPath;
      const hay =
        `${threadDisplayLabel(t)} ${t.title} ${t.branchName} ${t.agent} ${repo}`.toLowerCase();
      return hay.includes(q);
    });
  }, [archived, historyQuery]);

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
              className={`settings-nav-btn${nav === 'account' ? ' active' : ''}`}
              onClick={() => {
                setNav('account');
                setAgentPanel(null);
              }}
            >
              Account
            </button>
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
            <button
              type="button"
              className={`settings-nav-btn${nav === 'advanced' ? ' active' : ''}`}
              onClick={() => {
                setNav('advanced');
                setAgentPanel(null);
              }}
            >
              Advanced
            </button>
            <button
              type="button"
              className={`settings-nav-btn${nav === 'history' ? ' active' : ''}`}
              onClick={() => {
                setNav('history');
                setAgentPanel(null);
              }}
            >
              History
            </button>
          </aside>

          <div className="settings-main">
            <div className="settings-main-header">
              <h3>
                {nav === 'account'
                  ? 'Account'
                  : nav === 'environment'
                  ? 'Environment'
                  : nav === 'advanced'
                    ? 'Advanced'
                    : activeAgent
                      ? activeAgent.label
                      : 'Agents'}
              </h3>
              <button type="button" className="icon-btn" title="Close" onClick={onClose}>
                ✕
              </button>
            </div>

            {error && <div className="settings-error">{error}</div>}

            {nav === 'account' && (
              <div className="settings-body">
                <p className="settings-lead">
                  Connect GitHub and Linear for Create-from (PRs, branches, issues). These
                  connections are owned by Sideboard — not per-agent MCP.
                </p>

                <div className="settings-section settings-section-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">
                        Default agent, model &amp; effort
                      </div>
                      <p className="settings-hint">
                        Used for new workspace chats, chat tabs, the cloud orchestrator, and
                        MCP-spawned worktrees (when agent/model are omitted).
                      </p>
                      <p className="settings-status-text" style={{ marginTop: 8 }}>
                        {defaultAgentModelLabel(defaultAgent, defaultModel, defaultEffort)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => setDefaultsPickerOpen(true)}
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div className="settings-section settings-section-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">GitHub</div>
                      <p className="settings-hint">
                        Connect GitHub to clone repos, create PRs, load comments and more. Uses the{' '}
                        <code>gh</code> CLI on this machine.
                      </p>
                      {githubStatus?.connected ? (
                        <p className="settings-status-text" style={{ marginTop: 8 }}>
                          <span className="settings-dot ok" style={{ display: 'inline-block', marginRight: 8 }} />
                          Connected to {githubStatus.login ?? 'GitHub'}
                        </p>
                      ) : (
                        <p className="settings-hint" style={{ marginTop: 8 }}>
                          {githubStatus?.reason ?? 'Not connected'}
                        </p>
                      )}
                    </div>
                    <div className="row" style={{ gap: 8, margin: 0 }}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void window.sideboard
                            .getGitHubStatus()
                            .then(setGithubStatus)
                            .catch((err) =>
                              setError(err instanceof Error ? err.message : String(err)),
                            );
                        }}
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => {
                          void window.sideboard.openExternal(
                            'https://cli.github.com/manual/gh_auth_login',
                          );
                        }}
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Linear</div>
                  <p className="settings-hint">
                    Connect Linear so Sideboard can use issue context from your account. Create an
                    API key at linear.app/settings/api.
                  </p>
                  {settings.integrations.linearApiKey ? (
                    <div className="settings-toggle-row" style={{ marginTop: 10 }}>
                      <div>
                        <p className="settings-status-text">
                          <span className="settings-dot ok" style={{ display: 'inline-block', marginRight: 8 }} />
                          Connected
                          {showLinearKey
                            ? ` · ${settings.integrations.linearApiKey}`
                            : ` · ${maskSecret(settings.integrations.linearApiKey)}`}
                        </p>
                      </div>
                      <div className="row" style={{ gap: 8, margin: 0 }}>
                        <button
                          type="button"
                          onClick={() => setShowLinearKey((v) => !v)}
                        >
                          {showLinearKey ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveIntegrationsPatch({ linearApiKey: null })}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="row" style={{ marginTop: 10, gap: 8 }}>
                      <input
                        type={showLinearKey ? 'text' : 'password'}
                        value={linearKeyDraft}
                        onChange={(e) => setLinearKeyDraft(e.target.value)}
                        placeholder="lin_api_…"
                        style={{ flex: 1 }}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || !linearKeyDraft.trim()}
                        onClick={() =>
                          void saveIntegrationsPatch({ linearApiKey: linearKeyDraft.trim() })
                        }
                      >
                        Connect
                      </button>
                    </div>
                  )}
                </div>

                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Issue source</div>
                  <p className="settings-hint">
                    Prefer GitHub Issues or Linear in Create-from. If Linear is selected but not
                    connected, GitHub Issues are used automatically.
                  </p>
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    {([
                      { id: 'github' as const, label: 'GitHub Issues' },
                      { id: 'linear' as const, label: 'Linear' },
                    ]).map((opt) => {
                      const preferred = settings.integrations.issueSource ?? 'github';
                      const active = preferred === opt.id;
                      const linearOk = Boolean(settings.integrations.linearApiKey);
                      const disabled = opt.id === 'linear' && !linearOk;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={active ? 'primary' : ''}
                          disabled={busy || disabled}
                          title={
                            disabled
                              ? 'Connect Linear first'
                              : undefined
                          }
                          onClick={() =>
                            void saveIntegrationsPatch({ issueSource: opt.id })
                          }
                        >
                          {opt.label}
                          {opt.id === 'linear' && !linearOk ? ' (not connected)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

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
                          ? a.bundled
                            ? 'Ready · SDK (no CLI install)'
                            : 'Ready'
                          : st?.reason ||
                            (st?.installed
                              ? 'Needs auth'
                              : a.bundled
                                ? 'Needs API key'
                                : 'Not installed');
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
                        ? activeAgent.bundled
                          ? 'Authenticated (Cursor SDK)'
                          : 'Authenticated'
                        : activeStatus?.reason || 'Not ready'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy || setupBusy != null}
                    onClick={() => void reload()}
                  >
                    Refresh
                  </button>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Setup</div>
                  <p className="settings-hint">
                    {activeAgent.bundled
                      ? 'Cursor is bundled with Sideboard — paste a CURSOR_API_KEY below (no package install).'
                      : 'Install the CLI if missing, then authenticate. Install uses npm when possible; login opens Terminal.'}
                  </p>
                  <div className="settings-actions">
                    {!activeAgent.bundled && (
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || setupBusy != null}
                        onClick={() => void runInstall()}
                      >
                        {setupBusy === 'install' ? 'Installing…' : 'Install'}
                      </button>
                    )}
                    {!activeAgent.bundled && (
                      <button
                        type="button"
                        disabled={busy || setupBusy != null}
                        onClick={() => void runLogin()}
                      >
                        {setupBusy === 'login' ? 'Opening…' : 'Log in'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void window.sideboard.openExternal(activeAgent.docsUrl)}
                    >
                      {activeAgent.bundled ? 'Get API key' : 'Docs'}
                    </button>
                  </div>
                  {setupLog && (
                    <pre className="settings-setup-log" tabIndex={0}>
                      {setupLog}
                    </pre>
                  )}
                </div>

                {activeAgent.id === 'claude' && (
                  <>
                    <div className="settings-section">
                      <div className="settings-toggle-row">
                        <div>
                          <div className="settings-section-title">Use Claude Code with Chrome</div>
                          <p className="settings-hint">
                            Passes <code>--chrome</code> on Sideboard Claude turns and auto-approves
                            browser tools. Requires the{' '}
                            <button
                              type="button"
                              className="settings-link"
                              onClick={() => void window.sideboard.openExternal(CLAUDE_CHROME_EXTENSION)}
                            >
                              Claude in Chrome extension
                            </button>{' '}
                            and a claude.ai login (not API-key-only).{' '}
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
                          registered Sideboard workspaces via the Orchestration coordinator (no
                          home repo) — Slack, Discord, or Microsoft Teams (Slack is best-tested).
                          Requires <code>brightsy login</code> and a chat channel on the Brightsy
                          agent. Keep the desktop app running.
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

                    <div className="settings-toggle-row" style={{ marginTop: '0.85rem' }}>
                      <div>
                        <div className="settings-section-title">
                          Caffeinate while cloud connect is on
                        </div>
                        <p className="settings-hint">
                          Keep the Mac awake while listening for Slack / Discord / Teams messages
                          (macOS only; lid-close may still sleep on battery).
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`settings-switch${advanced.caffeinateWhileCloudConnect ? ' on' : ''}`}
                        role="switch"
                        aria-checked={Boolean(advanced.caffeinateWhileCloudConnect)}
                        disabled={busy}
                        onClick={() =>
                          void saveAdvancedPatch({
                            caffeinateWhileCloudConnect: !advanced.caffeinateWhileCloudConnect,
                          })
                        }
                      >
                        <span className="settings-switch-knob" />
                      </button>
                    </div>

                    <label className="settings-label" htmlFor="cloud-connect-agent">
                      Coordinator agent
                    </label>
                    <p className="settings-hint" style={{ marginBottom: '0.45rem' }}>
                      Uses Account default when that agent can orchestrate (Claude, Cursor,
                      Codex, or OpenCode). Currently:{' '}
                      <strong>
                        {cloudConnect?.agent ??
                          settings.brightsy?.cloudConnectAgent ??
                          defaultAgent}
                      </strong>
                      {defaultAgent === 'brightsy'
                        ? ' — set a fallback below because Brightsy cannot run the coordinator.'
                        : null}
                    </p>
                    {defaultAgent === 'brightsy' ? (
                      <select
                        id="cloud-connect-agent"
                        className="settings-select"
                        disabled={busy}
                        value={
                          cloudConnect?.agent ??
                          settings.brightsy?.cloudConnectAgent ??
                          'claude'
                        }
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
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => setDefaultsPickerOpen(true)}
                      >
                        Change account default
                      </button>
                    )}

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

            {nav === 'advanced' && (
              <div className="settings-body">
                <p className="settings-lead">
                  Power-user preferences inspired by Conductor. Repo scripts and files-to-copy still
                  live in <code>.sideboard/settings.toml</code> (or{' '}
                  <code>.conductor/settings.toml</code>).
                </p>

                <div className="settings-section">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">
                        Auto-rename placeholder branch on send
                      </div>
                      <p className="settings-hint">
                        On the first agent turn, ask the agent to rename temporary{' '}
                        <code>thread/&lt;team&gt;</code> branches to a task-shaped name (Conductor
                        Git default: on).
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${autoRenameOn ? ' on' : ''}`}
                      role="switch"
                      aria-checked={autoRenameOn}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({ autoRenameBranch: !autoRenameOn })
                      }
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">Auto-run after setup</div>
                      <p className="settings-hint">
                        After a new workspace finishes its setup script, start the default run/dev
                        script (Conductor <code>scripts.auto_run_after_setup</code>).
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.autoRunAfterSetup ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.autoRunAfterSetup)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          autoRunAfterSetup: !advanced.autoRunAfterSetup,
                        })
                      }
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">
                        Caffeinate while agents are running
                      </div>
                      <p className="settings-hint">
                        Keep the Mac awake with <code>caffeinate</code> while any agent turn is
                        running (macOS only).
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.caffeinateWhileRunning ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.caffeinateWhileRunning)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          caffeinateWhileRunning: !advanced.caffeinateWhileRunning,
                        })
                      }
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">Delete branch on purge</div>
                      <p className="settings-hint">
                        When purging a thread, also delete its git branch (Conductor{' '}
                        <code>git.delete_branch_on_archive</code>).
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.deleteBranchOnPurge ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.deleteBranchOnPurge)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          deleteBranchOnPurge: !advanced.deleteBranchOnPurge,
                        })
                      }
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">Auto-clean orphan worktrees</div>
                      <p className="settings-hint">
                        Remove Sideboard worktrees with no thread record when over the machine max
                        (Cursor-style cleanup).
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.autoCleanupOrphans ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.autoCleanupOrphans)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          autoCleanupOrphans: !advanced.autoCleanupOrphans,
                        })
                      }
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-title">Orchestration session limit</div>
                  <p className="settings-hint">
                    When a Global orchestration chat hits a provider session/usage limit (not
                    context size), Sideboard continues automatically.
                  </p>
                  <div className="settings-key-row" style={{ marginTop: '0.5rem', gap: '0.75rem' }}>
                    <label className="settings-hint" htmlFor="orch-quota-action">
                      On limit
                    </label>
                    <select
                      id="orch-quota-action"
                      value={advanced.orchestrationQuotaOnLimit ?? 'switch_agent'}
                      disabled={busy}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== 'switch_agent' && v !== 'wait_reset') return;
                        void saveAdvancedPatch({ orchestrationQuotaOnLimit: v });
                      }}
                    >
                      <option value="switch_agent">Continue on another agent (Auto)</option>
                      <option value="wait_reset">Wait for reset, then retry</option>
                    </select>
                  </div>
                  {(advanced.orchestrationQuotaOnLimit ?? 'switch_agent') === 'switch_agent' && (
                    <div
                      className="settings-key-row"
                      style={{ marginTop: '0.5rem', gap: '0.75rem' }}
                    >
                      <label className="settings-hint" htmlFor="orch-quota-fallback">
                        Fallback agent
                      </label>
                      <select
                        id="orch-quota-fallback"
                        value={advanced.orchestrationQuotaFallbackAgent ?? 'cursor'}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value as AgentKind;
                          if (!(ORCHESTRATOR_AGENT_KINDS as readonly string[]).includes(v)) {
                            return;
                          }
                          void saveAdvancedPatch({ orchestrationQuotaFallbackAgent: v });
                        }}
                      >
                        {ORCHESTRATOR_AGENT_KINDS.map((id) => (
                          <option key={id} value={id}>
                            {DEFAULT_AGENT_LABELS[id]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="settings-section">
                  <label className="settings-section-title" htmlFor="max-concurrent-agents">
                    Max concurrent agents
                  </label>
                  <p className="settings-hint">
                    Cap how many agent turns can run at once across the global orchestrator.
                  </p>
                  <div className="settings-key-row" style={{ marginTop: '0.5rem' }}>
                    <input
                      id="max-concurrent-agents"
                      type="number"
                      min={1}
                      max={32}
                      step={1}
                      value={maxConcurrentDraft}
                      disabled={busy}
                      onChange={(e) => setMaxConcurrentDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        busy ||
                        !maxConcurrentDraft.trim() ||
                        Number(maxConcurrentDraft) === (advanced.maxConcurrent ?? 3)
                      }
                      onClick={() => {
                        const n = Number(maxConcurrentDraft);
                        if (!Number.isFinite(n)) {
                          setError('Max concurrent must be a number');
                          return;
                        }
                        void saveAdvancedPatch({ maxConcurrent: n });
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
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

            {nav === 'history' && (
              <div className="settings-body">
                <p className="settings-lead">
                  Archived chats and worktrees. Restore one to bring it back to the sidebar, or open
                  it read-only from here.
                </p>
                <div className="settings-section settings-section-card">
                  <label className="settings-section-title" htmlFor="history-search">
                    Search history
                  </label>
                  <input
                    id="history-search"
                    className="settings-history-search"
                    type="search"
                    placeholder="Filter by title, branch, agent, or project…"
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    spellCheck={false}
                    autoFocus
                  />
                  <div className="settings-history-list" role="list">
                    {filteredArchived.length === 0 ? (
                      <div className="settings-empty">
                        {archived.length === 0
                          ? 'No archived chats yet.'
                          : 'No archived chats match that search.'}
                      </div>
                    ) : (
                      filteredArchived.map((t) => {
                        const repo =
                          t.repoPath.split('/').filter(Boolean).pop() ?? t.repoPath;
                        return (
                          <div key={t.id} className="settings-history-row" role="listitem">
                            <button
                              type="button"
                              className="settings-history-open"
                              onClick={() => onOpenArchived?.(t.id)}
                              title="Open archived chat"
                            >
                              <span className="settings-history-title">
                                {threadDisplayLabel(t)}
                              </span>
                              <span className="settings-history-meta">
                                {repo} · {t.agent} · archived
                              </span>
                            </button>
                            <button
                              type="button"
                              className="settings-history-restore"
                              onClick={() => onRestoreArchived?.(t.id)}
                            >
                              Restore
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <AgentOptionsPicker
        open={defaultsPickerOpen}
        value={{
          agent: defaultAgent,
          model: defaultModel,
          autonomy: 'default' as Autonomy,
          effort: defaultEffort,
        }}
        title="Default agent, model & effort"
        confirmLabel="Save"
        onClose={() => setDefaultsPickerOpen(false)}
        onApply={(next) => {
          void saveDefaultsPatch({
            agent: next.agent,
            model: next.model,
            effort: next.effort,
          });
        }}
      />
    </div>
  );
}
