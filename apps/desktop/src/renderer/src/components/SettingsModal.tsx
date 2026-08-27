import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdvancedAppSettings,
  AgentKind,
  AgentSetupActionResult,
  AgentStatus,
  Autonomy,
  BrightsySession,
  CliAgentKind,
  SlackListenStatus,
  GitHubStatus,
  GithubGitAuthMode,
  IssueSource,
  PublicAppSettings,
  SlackWorkspaceInfo,
  ThinkingEffort,
  Thread,
} from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import { SchedulesSettings } from './SchedulesSettings';
import { parseThinkingEffort, thinkingEffortLabel } from './ThinkingEffortChip';

type NavId = 'account' | 'agents' | 'environment' | 'schedules' | 'advanced' | 'history';
type AgentPanel = 'claude' | 'codex' | 'opencode' | 'cursor' | 'brightsy';

const CLI_PATH_AGENTS = new Set<AgentPanel>(['claude', 'codex', 'opencode', 'brightsy']);

function isCliPathAgent(id: AgentPanel | null): id is CliAgentKind {
  return id != null && CLI_PATH_AGENTS.has(id);
}

const CLI_PATH_LABELS: Record<CliAgentKind, { title: string; bin: string; systemLabel: string }> = {
  claude: {
    title: 'Claude Code executable path',
    bin: 'claude',
    systemLabel: 'Use system Claude Code',
  },
  codex: {
    title: 'Codex executable path',
    bin: 'codex',
    systemLabel: 'Use system Codex',
  },
  opencode: {
    title: 'OpenCode executable path',
    bin: 'opencode',
    systemLabel: 'Use system OpenCode',
  },
  brightsy: {
    title: 'Brightsy executable path',
    bin: 'brightsy',
    systemLabel: 'Use system Brightsy',
  },
};

function emptyAppSettings(): PublicAppSettings {
  return {
    environment: {},
    claude: {},
    codex: {},
    opencode: {},
    brightsy: {},
    integrations: {
      hasLinearApiKey: false,
      hasLinearOAuth: false,
      hasSlackClientSecret: false,
      hasSlackAppToken: false,
      hasGithubPat: false,
      hasAbleTimeToken: false,
    },
    defaults: {},
    advanced: {},
  };
}

function storedExecutablePath(settings: PublicAppSettings, agent: CliAgentKind): string {
  if (agent === 'claude') return settings.claude?.executablePath ?? '';
  if (agent === 'codex') return settings.codex?.executablePath ?? '';
  if (agent === 'opencode') return settings.opencode?.executablePath ?? '';
  return settings.brightsy?.executablePath ?? '';
}

function normalizeSettings(next: PublicAppSettings): PublicAppSettings {
  return {
    environment: next.environment ?? {},
    claude: next.claude ?? {},
    codex: next.codex ?? {},
    opencode: next.opencode ?? {},
    brightsy: next.brightsy ?? {},
    integrations: {
      hasLinearApiKey: false,
      hasLinearOAuth: false,
      hasSlackClientSecret: false,
      hasSlackAppToken: false,
      hasGithubPat: false,
      hasAbleTimeToken: false,
      ...next.integrations,
    },
    defaults: next.defaults ?? {},
    advanced: next.advanced ?? {},
  };
}

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
  /** Fired when settings are loaded or saved (so the board can react to Advanced toggles). */
  onSettingsChange?: (settings: PublicAppSettings) => void;
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
      'Hosted chat via the Brightsy CLI (`brightsy login`) — no local file edits. Connect a team below for Brightsy schema and files. Slack (Account) is how you remote-control this Mac.',
    docsUrl: 'https://www.npmjs.com/package/@brightsy/cli',
  },
];

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** IPC maps OAuth abort to these messages — do not import Node core into the renderer. */
function isOauthCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /sign-in cancelled/i.test(message);
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
  onSettingsChange,
}: Props) {
  const [nav, setNav] = useState<NavId>(initialNav);
  const [agentPanel, setAgentPanel] = useState<AgentPanel | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [settings, setSettings] = useState<PublicAppSettings>(emptyAppSettings);
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState('5');
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [cliPathDraft, setCliPathDraft] = useState('');
  const [systemCliPath, setSystemCliPath] = useState<string | null>(null);
  const [brightsySession, setBrightsySession] = useState<BrightsySession | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [slackWorkspaces, setSlackWorkspaces] = useState<SlackWorkspaceInfo[]>([]);
  const [slackListen, setSlackListen] = useState<SlackListenStatus | null>(null);
  const [slackTokenDraft, setSlackTokenDraft] = useState('');
  const [slackOauthBusy, setSlackOauthBusy] = useState(false);
  const [slackDeviceLabelDraft, setSlackDeviceLabelDraft] = useState('');
  const [linearKeyDraft, setLinearKeyDraft] = useState('');
  const [showLinearKey, setShowLinearKey] = useState(false);
  const [abletimeTokenDraft, setAbletimeTokenDraft] = useState('');
  const [showAbletimeToken, setShowAbletimeToken] = useState(false);
  const [abletimeHostDraft, setAbletimeHostDraft] = useState('');
  const [abletimeBusy, setAbletimeBusy] = useState(false);
  const [githubPatDraft, setGithubPatDraft] = useState('');
  const [showGithubPat, setShowGithubPat] = useState(false);
  const [linearOauthBusy, setLinearOauthBusy] = useState(false);
  const [defaultsPickerOpen, setDefaultsPickerOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState<'install' | 'login' | null>(null);
  const [setupLog, setSetupLog] = useState<string | null>(null);
  const loginAbortRef = useRef<AbortController | null>(null);

  async function reload() {
    const slackListenApi = window.sideboard.getSlackListenStatus;
    const [s, agents, session, gh, slack, slackIn] = await Promise.all([
      window.sideboard.getAppSettings(),
      window.sideboard.detectAgents(),
      window.sideboard.getBrightsySession().catch(() => null),
      window.sideboard.getGitHubStatus().catch(() => null),
      window.sideboard.getSlackWorkspaces().catch(() => [] as SlackWorkspaceInfo[]),
      typeof slackListenApi === 'function'
        ? slackListenApi().catch(() => null)
        : Promise.resolve(null),
    ]);
    const next = normalizeSettings(s);
    setSettings(next);
    setMaxConcurrentDraft(String(s.advanced?.maxConcurrent ?? 5));
    setStatuses(agents);
    setBrightsySession(session);
    setGithubStatus(gh);
    setSlackWorkspaces(slack);
    setSlackListen(slackIn);
    setLinearKeyDraft('');
    setAbletimeTokenDraft('');
    setAbletimeHostDraft(s.integrations.abletimeHost?.trim() || '');
    setSlackTokenDraft('');
    setSlackDeviceLabelDraft(
      s.integrations.slackDeviceLabel?.trim() ||
        slackIn?.deviceLabel?.trim() ||
        '',
    );
  }

  useEffect(() => {
    void reload().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  useEffect(() => {
    if (!isCliPathAgent(agentPanel)) {
      setCliPathDraft('');
      setSystemCliPath(null);
      return;
    }
    setCliPathDraft(storedExecutablePath(settings, agentPanel));
    void window.sideboard
      .resolveSystemAgentPath(agentPanel)
      .then(setSystemCliPath)
      .catch(() => setSystemCliPath(null));
  }, [agentPanel]);

  useEffect(() => {
    if (nav !== 'account') return;
    const api = window.sideboard.getSlackListenStatus;
    if (typeof api !== 'function') return;
    const id = window.setInterval(() => {
      void api()
        .then(setSlackListen)
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [nav]);

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

  useEffect(() => {
    return () => {
      void window.sideboard.cancelSlackOAuth?.();
      void window.sideboard.cancelLinearOAuth?.();
      loginAbortRef.current?.abort();
    };
  }, []);

  const envKeys = useMemo(
    () => Object.keys(settings.environment).sort((a, b) => a.localeCompare(b)),
    [settings.environment],
  );

  const activeAgent = agentPanel
    ? AGENT_PANELS.find((a) => a.id === agentPanel) ?? null
    : null;
  const activeStatus = agentPanel ? statusFor(statuses, agentPanel) : undefined;
  const hasActiveEnv =
    activeAgent?.envKey != null &&
    Object.prototype.hasOwnProperty.call(settings.environment, activeAgent.envKey);

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
    const agentId = activeAgent.id;
    loginAbortRef.current?.abort();
    const ac = new AbortController();
    loginAbortRef.current = ac;
    setSetupBusy('login');
    setSetupLog(null);
    setError(null);
    try {
      const result = await window.sideboard.loginAgent(agentId);
      if (ac.signal.aborted) return;
      setSetupLog(
        [
          formatSetupResult(result),
          'Finish signing in in that Terminal window (browser / ChatGPT). Sideboard will refresh when login completes.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (!result.openedTerminal) return;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        if (ac.signal.aborted) {
          setSetupLog((prev) => `${prev ?? ''}\n\nCancelled — click Log in again when you want to retry.`);
          return;
        }
        await new Promise<void>((resolve) => {
          const t = window.setTimeout(resolve, 2_000);
          ac.signal.addEventListener(
            'abort',
            () => {
              window.clearTimeout(t);
              resolve();
            },
            { once: true },
          );
        });
        if (ac.signal.aborted) {
          setSetupLog((prev) => `${prev ?? ''}\n\nCancelled — click Log in again when you want to retry.`);
          return;
        }
        const agents = await window.sideboard.detectAgents();
        setStatuses(agents);
        const st = statusFor(agents, agentId);
        if (st?.installed && st?.authenticated) {
          setSetupLog((prev) => `${prev ?? ''}\n\nDetected ${agentId} — authenticated.`);
          return;
        }
      }
      setSetupLog(
        (prev) =>
          `${prev ?? ''}\n\nStill waiting — click Refresh after the Terminal login finishes.`,
      );
    } catch (err) {
      if (!ac.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (loginAbortRef.current === ac) loginAbortRef.current = null;
      setSetupBusy(null);
    }
  }
  async function saveEnvPatch(patch: Record<string, string | null>) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateAppEnvironment(patch);
      applySettings(next);
      const agents = await window.sideboard.detectAgents();
      setStatuses(agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveClaudePatch(patch: { chromeEnabled?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateClaudeSettings(patch);
      applySettings(next);
      const agents = await window.sideboard.detectAgents();
      setStatuses(agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCliExecutablePath(agent: CliAgentKind, executablePath: string | null) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateAgentExecutable(agent, executablePath);
      applySettings(next);
      setCliPathDraft(storedExecutablePath(next, agent));
      const agents = await window.sideboard.detectAgents();
      setStatuses(agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function applySettings(next: PublicAppSettings) {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    setMaxConcurrentDraft(String(next.advanced?.maxConcurrent ?? 5));
    onSettingsChange?.(normalized);
  }

  async function saveIntegrationsPatch(patch: {
    linearApiKey?: string | null;
    issueSource?: IssueSource | null;
    slackDeviceLabel?: string | null;
    githubGitAuthMode?: GithubGitAuthMode | null;
    githubPat?: string | null;
    abletimeAccessToken?: string | null;
    abletimeHost?: string | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateIntegrationsSettings(patch);
      applySettings(next);
      setLinearKeyDraft('');
      if ('abletimeAccessToken' in patch) setAbletimeTokenDraft('');
      if ('githubPat' in patch) setGithubPatDraft('');
      if ('slackDeviceLabel' in patch) {
        setSlackDeviceLabelDraft(next.integrations.slackDeviceLabel?.trim() || '');
        const listenApi = window.sideboard.getSlackListenStatus;
        if (typeof listenApi === 'function') {
          setSlackListen(await listenApi().catch(() => null));
        }
      }
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

  async function saveBrightsyPatch(patch: { injectWorktreeMcp?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateBrightsySettings(patch);
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
              className={`settings-nav-btn${nav === 'schedules' ? ' active' : ''}`}
              onClick={() => {
                setNav('schedules');
                setAgentPanel(null);
              }}
            >
              Schedules
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
                  : nav === 'schedules'
                    ? 'Schedules'
                  : nav === 'advanced'
                    ? 'Advanced'
                    : nav === 'history'
                      ? 'History'
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
                  Connect GitHub, Linear, and Slack. These connections are owned by Sideboard —
                  not per-agent MCP.
                </p>

                <div className="settings-section settings-section-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">
                        Default agent, model &amp; effort
                      </div>
                      <p className="settings-hint">
                        Used for new workspace chats, chat tabs, and MCP-spawned worktrees
                        (when agent/model are omitted).
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
                        Choose how Sideboard and worktree agents authenticate git on this Mac.
                        The selected mode is injected into agent prompts so they use the same path.
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
                  <div className="settings-mode-list" role="radiogroup" aria-label="GitHub git authentication">
                    {(
                      [
                        {
                          id: 'auto' as const,
                          title: 'Auto',
                          badge: 'Recommended',
                          hint: 'HTTPS in the agent process using this Mac’s gh login. Keychain may prompt once at app start; Slack and unattended Cursor turns do not.',
                        },
                        {
                          id: 'gh' as const,
                          title: 'gh CLI auth',
                          hint: 'Rewrite git@github.com remotes to HTTPS. git/gh use a Sideboard credential file — no GH_TOKEN in the agent, no Keychain after launch.',
                        },
                        {
                          id: 'ssh' as const,
                          title: 'SSH',
                          hint: 'Keep SSH remotes. Batch-mode only — will not prompt Keychain. Slack/Cursor fail if ssh-agent is locked.',
                        },
                        {
                          id: 'token' as const,
                          title: 'Personal access token',
                          hint: 'Store a PAT on this Mac. Agents get HTTPS remotes via the same credential file (token is not in their environment).',
                        },
                      ] satisfies Array<{
                        id: GithubGitAuthMode;
                        title: string;
                        hint: string;
                        badge?: string;
                      }>
                    ).map((opt) => {
                      const selected =
                        (settings.integrations.githubGitAuthMode ?? 'auto') === opt.id;
                      return (
                        <label
                          key={opt.id}
                          className={`settings-mode-option${selected ? ' selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="github-git-auth-mode"
                            checked={selected}
                            disabled={busy}
                            onChange={() =>
                              void saveIntegrationsPatch({ githubGitAuthMode: opt.id })
                            }
                          />
                          <div className="settings-mode-option-body">
                            <div className="settings-mode-option-title">
                              {opt.title}
                              {opt.badge ? (
                                <span className="settings-badge">{opt.badge}</span>
                              ) : null}
                            </div>
                            <p className="settings-hint" style={{ marginTop: 4 }}>
                              {opt.hint}
                            </p>
                            {opt.id === 'token' && selected ? (
                              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                                {settings.integrations.hasGithubPat ? (
                                  <>
                                    <p className="settings-status-text" style={{ flex: 1, margin: 0 }}>
                                      Token saved on this Mac
                                    </p>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void saveIntegrationsPatch({ githubPat: null })
                                      }
                                    >
                                      Clear
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <input
                                      type={showGithubPat ? 'text' : 'password'}
                                      value={githubPatDraft}
                                      onChange={(e) => setGithubPatDraft(e.target.value)}
                                      placeholder="ghp_… or github_pat_…"
                                      style={{ flex: 1 }}
                                      autoComplete="off"
                                    />
                                    <button
                                      type="button"
                                      className="settings-inline-btn"
                                      onClick={() => setShowGithubPat((v) => !v)}
                                    >
                                      {showGithubPat ? 'Hide' : 'Show'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy || !githubPatDraft.trim()}
                                      onClick={() =>
                                        void saveIntegrationsPatch({
                                          githubPat: githubPatDraft.trim(),
                                        })
                                      }
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      className="settings-inline-btn"
                                      onClick={() => {
                                        void window.sideboard.openExternal(
                                          'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow',
                                        );
                                      }}
                                    >
                                      Create token
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Linear</div>
                  <p className="settings-hint">
                    Connect Linear so Sideboard can list, create, update, and comment on issues.
                    Sign in with your browser — same pattern as Slack. If you connected before
                    write access shipped, Disconnect and Connect via browser again.
                  </p>
                  {settings.integrations.hasLinearApiKey ? (
                    <div className="settings-toggle-row" style={{ marginTop: 10 }}>
                      <div>
                        <p className="settings-status-text">
                          <span className="settings-dot ok" style={{ display: 'inline-block', marginRight: 8 }} />
                          {settings.integrations.hasLinearOAuth
                            ? [
                                'Connected',
                                settings.integrations.linearViewerName,
                                settings.integrations.linearOrganizationName,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : 'Connected · key saved on this Mac'}
                        </p>
                      </div>
                      <div className="row" style={{ gap: 8, margin: 0 }}>
                        <button
                          type="button"
                          disabled={busy || linearOauthBusy}
                          onClick={() => {
                            setBusy(true);
                            setError(null);
                            void window.sideboard
                              .disconnectLinear()
                              .then((next) => applySettings(next))
                              .catch((err) =>
                                setError(err instanceof Error ? err.message : String(err)),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="row" style={{ marginTop: 10, gap: 8 }}>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || linearOauthBusy}
                        onClick={() => {
                          setLinearOauthBusy(true);
                          setError(null);
                          void window.sideboard
                            .startLinearOAuth()
                            .then((next) => applySettings(next))
                            .catch((err) => {
                              if (isOauthCancelled(err)) return;
                              setError(err instanceof Error ? err.message : String(err));
                            })
                            .finally(() => setLinearOauthBusy(false));
                        }}
                      >
                        {linearOauthBusy ? 'Waiting for Linear…' : 'Connect via browser'}
                      </button>
                      {linearOauthBusy ? (
                        <button
                          type="button"
                          onClick={() => {
                            void window.sideboard.cancelLinearOAuth();
                          }}
                        >
                          Cancel
                        </button>
                      ) : null}
                      <input
                        type={showLinearKey ? 'text' : 'password'}
                        value={linearKeyDraft}
                        onChange={(e) => setLinearKeyDraft(e.target.value)}
                        placeholder="or paste lin_api_…"
                        style={{ flex: 1 }}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        disabled={busy || linearOauthBusy || !linearKeyDraft.trim()}
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
                  <div className="settings-section-title">AbleTime</div>
                  <p className="settings-hint">
                    Connect AbleTime so Sideboard can list tasks and auto-create one
                    to track against when you start work without a ticket. Uses
                    AbleTime&apos;s hosted MCP (
                    <code>POST /api/public/v2/mcp</code>
                    ). Enable <strong>Agent access (MCP)</strong> in AbleTime, then
                    paste a personal access token from Profile → API Access (
                    <code>apt_…</code>
                    ).
                  </p>
                  {settings.integrations.hasAbleTimeToken ? (
                    <div className="settings-toggle-row" style={{ marginTop: 10 }}>
                      <div>
                        <p className="settings-status-text">
                          <span className="settings-dot ok" style={{ display: 'inline-block', marginRight: 8 }} />
                          {[
                            'Connected',
                            settings.integrations.abletimeViewerName,
                            settings.integrations.abletimeHost,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="row" style={{ gap: 8, margin: 0 }}>
                        <button
                          type="button"
                          disabled={busy || abletimeBusy}
                          onClick={() => {
                            setBusy(true);
                            setError(null);
                            void window.sideboard
                              .disconnectAbleTime()
                              .then((next) => applySettings(next))
                              .catch((err) =>
                                setError(err instanceof Error ? err.message : String(err)),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <input
                          type={showAbletimeToken ? 'text' : 'password'}
                          value={abletimeTokenDraft}
                          onChange={(e) => setAbletimeTokenDraft(e.target.value)}
                          placeholder="apt_…"
                          style={{ flex: 1 }}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="settings-inline-btn"
                          onClick={() => setShowAbletimeToken((v) => !v)}
                        >
                          {showAbletimeToken ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || abletimeBusy || !abletimeTokenDraft.trim()}
                          onClick={() => {
                            setAbletimeBusy(true);
                            setError(null);
                            void window.sideboard
                              .connectAbleTime({
                                token: abletimeTokenDraft.trim(),
                                host: abletimeHostDraft.trim() || null,
                              })
                              .then((next) => {
                                applySettings(next);
                                setAbletimeTokenDraft('');
                              })
                              .catch((err) =>
                                setError(err instanceof Error ? err.message : String(err)),
                              )
                              .finally(() => setAbletimeBusy(false));
                          }}
                        >
                          {abletimeBusy ? 'Checking…' : 'Connect'}
                        </button>
                      </div>
                      <input
                        value={abletimeHostDraft}
                        onChange={(e) => setAbletimeHostDraft(e.target.value)}
                        placeholder="https://track.abletime.com"
                        style={{ marginTop: 8, width: '100%' }}
                        autoComplete="off"
                      />
                    </div>
                  )}
                </div>

                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Slack workspaces</div>
                  <p className="settings-hint">
                    Click <strong>Add via browser</strong> to install the Sideboard Slack app into a
                    workspace. Listening starts automatically. DMs and @mentions go to the Global
                    orchestrator while Sideboard is running. Until the Slack app has{' '}
                    <strong>Public Distribution</strong> on, Slack only offers the home workspace
                    (Brightsy) — that is a Slack app setting, not a Sideboard picker.
                  </p>
                  {slackWorkspaces.length > 0 ? (
                    <div className="settings-check-list" style={{ marginTop: 10 }}>
                      {slackWorkspaces.map((ws) => (
                        <div key={ws.team_id} className="settings-toggle-row">
                          <div>
                            <p className="settings-status-text">
                              <span
                                className="settings-dot ok"
                                style={{ display: 'inline-block', marginRight: 8 }}
                              />
                              {ws.team_name}
                              <span className="settings-hint"> · {ws.team_id}</span>
                              {!ws.has_user_token ? (
                                <span className="settings-hint"> · search needs user token</span>
                              ) : null}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={busy || slackOauthBusy}
                      onClick={() => {
                        setBusy(true);
                        setError(null);
                        void window.sideboard
                          .disconnectSlackWorkspace(ws.team_id)
                          .then((list) => {
                            setSlackWorkspaces(list);
                            return window.sideboard.getSlackListenStatus?.();
                          })
                          .then((status) => {
                            if (status) setSlackListen(status);
                          })
                          .catch((err) =>
                            setError(err instanceof Error ? err.message : String(err)),
                          )
                          .finally(() => setBusy(false));
                      }}
                          >
                            Disconnect
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-hint" style={{ marginTop: 8 }}>
                      No workspaces connected yet.
                    </p>
                  )}
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <input
                      type="password"
                      value={slackTokenDraft}
                      onChange={(e) => setSlackTokenDraft(e.target.value)}
                      placeholder="xoxb-… or xoxp-…"
                      style={{ flex: 1 }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || slackOauthBusy || !slackTokenDraft.trim()}
                      onClick={() => {
                        setBusy(true);
                        setError(null);
                        void window.sideboard
                          .connectSlackToken(slackTokenDraft.trim())
                          .then((list) => {
                            setSlackWorkspaces(list);
                            setSlackTokenDraft('');
                            return window.sideboard.getSlackListenStatus?.();
                          })
                          .then((status) => {
                            if (status) setSlackListen(status);
                          })
                          .catch((err) =>
                            setError(err instanceof Error ? err.message : String(err)),
                          )
                          .finally(() => setBusy(false));
                      }}
                    >
                      Add workspace
                    </button>
                    <button
                      type="button"
                      disabled={busy || slackOauthBusy}
                      onClick={() => {
                        setSlackOauthBusy(true);
                        setError(null);
                        void window.sideboard
                          .startSlackOAuth()
                          .then((list) => {
                            setSlackWorkspaces(list);
                            return window.sideboard.getSlackListenStatus?.();
                          })
                          .then((status) => {
                            if (status) setSlackListen(status);
                          })
                          .catch((err) => {
                            if (isOauthCancelled(err)) return;
                            setError(err instanceof Error ? err.message : String(err));
                          })
                          .finally(() => setSlackOauthBusy(false));
                      }}
                    >
                      {slackOauthBusy ? 'Waiting for Slack…' : 'Add via browser'}
                    </button>
                    {slackOauthBusy ? (
                      <button
                        type="button"
                        onClick={() => {
                          void window.sideboard.cancelSlackOAuth();
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div className="settings-section-title">This Mac</div>
                    <p className="settings-hint">
                      Each MacBook is its own Slack destination. Name this one{' '}
                      <strong>Personal</strong> or <strong>Work</strong>. Replies come
                      back as <code>Work: …</code> so you know which Mac answered.
                      Address one with <code>work:</code> or <code>personal:</code> at
                      the start of the DM (case doesn&apos;t matter).
                    </p>
                    <div className="row" style={{ marginTop: 8, gap: 8 }}>
                      <input
                        value={slackDeviceLabelDraft}
                        onChange={(e) => setSlackDeviceLabelDraft(e.target.value)}
                        placeholder="Personal"
                        style={{ flex: 1 }}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          busy ||
                          !slackDeviceLabelDraft.trim() ||
                          slackDeviceLabelDraft.trim() ===
                            (settings.integrations.slackDeviceLabel?.trim() || '')
                        }
                        onClick={() =>
                          void saveIntegrationsPatch({
                            slackDeviceLabel: slackDeviceLabelDraft.trim(),
                          })
                        }
                      >
                        Save name
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div className="settings-section-title">Listening</div>
                    <p className="settings-hint">
                      DMs to the bot and @mentions go to the Global orchestrator. Keep Sideboard
                      running.
                    </p>
                  </div>
                  <p className="settings-hint" style={{ marginTop: 8 }}>
                    {slackListen?.workspaceCount
                      ? slackListen.running
                        ? `${
                            slackListen.mode === 'relay'
                              ? 'Relay connected'
                              : 'Listening'
                          }${slackListen.deviceLabel ? ` · ${slackListen.deviceLabel}` : ''} · ${slackListen.workspaceCount} workspace${slackListen.workspaceCount === 1 ? '' : 's'}`
                        : slackListen.lastError
                          ? `Not connected — ${slackListen.lastError}`
                          : slackListen.mode
                            ? 'Connecting…'
                            : 'Listen is not available on this Mac yet.'
                      : 'Connect a workspace to start listening.'}
                  </p>
                  {slackListen?.lastLog ? (
                    <p className="settings-hint settings-cloud-log">{slackListen.lastLog}</p>
                  ) : null}
                  <p className="settings-hint" style={{ marginTop: 12 }}>
                    Connect a workspace with Add via browser. Listening only receives your Slack
                    user&apos;s messages on this Mac.
                  </p>
                </div>

                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Issue source</div>
                  <p className="settings-hint">
                    Prefer GitHub Issues, Linear, or AbleTime in Create-from and Home.
                    If the preferred tracker is not connected, GitHub Issues are used
                    automatically. When AbleTime is selected, new work without a ticket
                    auto-creates a task to track against.
                  </p>
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    {([
                      { id: 'github' as const, label: 'GitHub Issues' },
                      { id: 'linear' as const, label: 'Linear' },
                      { id: 'abletime' as const, label: 'AbleTime' },
                    ]).map((opt) => {
                      const preferred = settings.integrations.issueSource ?? 'github';
                      const active = preferred === opt.id;
                      const linearOk = Boolean(settings.integrations.hasLinearApiKey);
                      const abletimeOk = Boolean(settings.integrations.hasAbleTimeToken);
                      const disabled =
                        (opt.id === 'linear' && !linearOk) ||
                        (opt.id === 'abletime' && !abletimeOk);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={active ? 'primary' : ''}
                          disabled={busy || disabled}
                          title={
                            disabled
                              ? opt.id === 'abletime'
                                ? 'Connect AbleTime first'
                                : 'Connect Linear first'
                              : undefined
                          }
                          onClick={() =>
                            void saveIntegrationsPatch({ issueSource: opt.id })
                          }
                        >
                          {opt.label}
                          {opt.id === 'linear' && !linearOk ? ' (not connected)' : ''}
                          {opt.id === 'abletime' && !abletimeOk ? ' (not connected)' : ''}
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
                    const meta =
                      a.id === 'brightsy' && ready
                        ? connectedCount > 0
                          ? `Ready · ${connectedCount} team${connectedCount === 1 ? '' : 's'} connected`
                          : 'Ready · connect a team for schema and files'
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
                      : 'If Conductor is installed, Sideboard reuses its Claude/Codex CLIs (no second copy). Otherwise: Install the CLI, then Log in. Install runs npm only when the CLI is missing. Log in opens Terminal — finish it there, then status updates.'}
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
                        {setupBusy === 'login' ? 'Waiting for login…' : 'Log in'}
                      </button>
                    )}
                    {setupBusy === 'login' ? (
                      <button
                        type="button"
                        onClick={() => {
                          loginAbortRef.current?.abort();
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
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

                {(() => {
                  if (!isCliPathAgent(activeAgent.id)) return null;
                  const pathAgent = activeAgent.id;
                  const labels = CLI_PATH_LABELS[pathAgent];
                  return (
                    <div className="settings-section">
                      <label
                        className="settings-section-title"
                        htmlFor={`${pathAgent}-executable-path`}
                      >
                        {labels.title}
                      </label>
                      <p className="settings-hint">
                        Override the executable. Leave empty to use the system{' '}
                        <code>{labels.bin}</code>
                        {systemCliPath ? ` (${systemCliPath})` : ' on PATH'} (recommended).
                      </p>
                      <div className="settings-key-row">
                        <input
                          id={`${pathAgent}-executable-path`}
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={systemCliPath || labels.bin}
                          value={cliPathDraft}
                          onChange={(e) => setCliPathDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          title="Browse"
                          disabled={busy}
                          onClick={() => {
                            void window.sideboard.pickAgentExecutable(pathAgent).then((path) => {
                              if (!path) return;
                              setCliPathDraft(path);
                              void saveCliExecutablePath(pathAgent, path);
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
                            cliPathDraft.trim() === storedExecutablePath(settings, pathAgent)
                          }
                          onClick={() =>
                            void saveCliExecutablePath(pathAgent, cliPathDraft.trim() || null)
                          }
                        >
                          Save path
                        </button>
                        <button
                          type="button"
                          disabled={busy || !storedExecutablePath(settings, pathAgent)}
                          onClick={() => void saveCliExecutablePath(pathAgent, null)}
                        >
                          {labels.systemLabel}
                        </button>
                      </div>
                    </div>
                  );
                })()}

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
                          hasActiveEnv
                            ? 'Saved on this Mac — paste to replace'
                            : `Paste ${activeAgent.envKey}`
                        }
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
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
                      {hasActiveEnv && (
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

                {activeAgent.id === 'brightsy' && (
                  <div className="settings-section">
                    <div className="settings-section-title">Brightsy teams</div>
                    <p className="settings-hint">
                      Uses <code>brightsy teams</code> / <code>switch</code>. Connected teams
                      unlock hosted Brightsy chat and the Brightsy schema/files datasource. Slack
                      (Account) is the remote path for this Mac.
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
                        Inject Brightsy MCP on Claude, Codex, and OpenCode
                      </div>
                      <p className="settings-hint">
                        Off by default. Optional Brightsy tools on worktree chats when you are
                        logged in. When off, they only get those tools if you say “use Brightsy…” or
                        the thread already used them. Orchestration chats still get them when
                        logged in.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${settings.brightsy?.injectWorktreeMcp ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(settings.brightsy?.injectWorktreeMcp)}
                      disabled={busy}
                      onClick={() =>
                        void saveBrightsyPatch({
                          injectWorktreeMcp: !settings.brightsy?.injectWorktreeMcp,
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
                      <div className="settings-section-title">
                        Caffeinate while Slack Listen is on
                      </div>
                      <p className="settings-hint">
                        Keep the Mac awake while Sideboard is listening for Slack DMs and
                        @mentions (macOS only; lid-close may still sleep on battery).
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.caffeinateWhileSlackListen ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.caffeinateWhileSlackListen)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          caffeinateWhileSlackListen: !advanced.caffeinateWhileSlackListen,
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
                        Caffeinate while schedules are enabled
                      </div>
                      <p className="settings-hint">
                        Keep the Mac awake so due jobs can fire (macOS only). Off by default so
                        a daily 9am cron does not pin the machine awake. Lid-close may still
                        sleep on battery.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.caffeinateWhileSchedules ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.caffeinateWhileSchedules)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          caffeinateWhileSchedules: !advanced.caffeinateWhileSchedules,
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
                      <div className="settings-section-title">Cowboy mode</div>
                      <p className="settings-hint">
                        New chats can opt into the project folder on the default branch (no
                        isolated worktree) and push there. Off by default. Archive does not
                        delete the folder. After enabling, pick Cowboy from New chat → ⋯.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.cowboyMode ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.cowboyMode)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          cowboyMode: !advanced.cowboyMode,
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
                      <div className="settings-section-title">Show cost (when available)</div>
                      <p className="settings-hint">
                        Show provider-reported USD on message chips, the thread Σ total, and
                        worktree hover spend when the agent CLI reports it. Off by default.
                        Tokens still show either way; Codex never reports USD.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.showCost ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.showCost)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          showCost: !advanced.showCost,
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
                      <div className="settings-section-title">Auto-archive on merge</div>
                      <p className="settings-hint">
                        Optional Conductor-style behavior: when a linked PR merges, archive the
                        worktree. Off by default — merged PRs still tint the right-sidebar header.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.autoArchiveOnMerge ? ' on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(advanced.autoArchiveOnMerge)}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          autoArchiveOnMerge: !advanced.autoArchiveOnMerge,
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
                        Number(maxConcurrentDraft) === (advanced.maxConcurrent ?? 5)
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
                  {envKeys.length === 0 && (
                    <div className="settings-empty">No environment variables yet.</div>
                  )}
                  {envKeys.map((key) => (
                    <div key={key} className="settings-env-row">
                      {editingEnvKey === key ? (
                        <>
                          <code className="settings-env-key">{key}</code>
                          <input
                            className="settings-env-input"
                            type="password"
                            value={draftValue}
                            autoFocus
                            spellCheck={false}
                            placeholder="Paste a new value to replace"
                            onChange={(e) => setDraftValue(e.target.value)}
                          />
                          <button
                            type="button"
                            className="primary"
                            disabled={busy || !draftValue.trim()}
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
                          <span className="settings-env-value">Saved on this Mac</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEnvKey(key);
                              setDraftValue('');
                            }}
                          >
                            Replace
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

            {nav === 'schedules' && <SchedulesSettings />}

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
