import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdvancedAppSettings,
  AgentKind,
  AgentSetupActionResult,
  AgentStatus,
  Autonomy,
  BrightsySession,
  CliAgentKind,
  PublicAppSettings,
  ThinkingEffort,
  Thread,
  Workspace,
} from '@sideboard-ai/core';
import { isUsageOnLimit, resolveUsageOnLimit } from '@sideboard/usage-on-limit';
import {
  HISTORY_MAX_COUNT_DEFAULT,
  HISTORY_MAX_COUNT_MAX,
  HISTORY_MAX_COUNT_MIN,
  HISTORY_MAX_DAYS_MAX,
  planHistoryAgePurge,
} from '@sideboard/history-retention';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import { emptyPublicIntegrations } from '../lib/optional-services';
import { orchestratorDefaultsFromSettings } from '../lib/thread-defaults';
import { ConnectorsSettings } from './ConnectorsSettings';
import { GitSettings } from './GitSettings';
import { IssuesSettings } from './IssuesSettings';
import { RemoteSettings } from './RemoteSettings';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import { SchedulesSettings } from './SchedulesSettings';
import { parseThinkingEffort, thinkingEffortLabel } from './ThinkingEffortChip';

export type SettingsNavId =
  | 'agents'
  | 'projects'
  | 'git'
  | 'issues'
  | 'remote'
  | 'connectors'
  | 'environment'
  | 'schedules'
  | 'advanced'
  | 'history';

const SETTINGS_NAV_TITLES: Record<Exclude<SettingsNavId, 'agents'>, string> = {
  projects: 'Projects',
  git: 'Git',
  issues: 'Issues',
  remote: 'Remote',
  connectors: 'Connectors',
  environment: 'Environment',
  schedules: 'Schedules',
  advanced: 'Advanced',
  history: 'History',
};
type NavId = SettingsNavId;
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
    integrations: emptyPublicIntegrations(),
    defaults: {},
    projects: {},
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
      ...emptyPublicIntegrations(),
      ...next.integrations,
    },
    defaults: next.defaults ?? {},
    projects: next.projects ?? {},
    advanced: next.advanced ?? {},
  };
}

function ProjectProfileCard({
  workspace,
  notesDraft,
  busy,
  onNotesChange,
  onNotesFocus,
  onNotesBlur,
}: {
  workspace: Workspace;
  notesDraft: string;
  busy?: boolean;
  onNotesChange: (notes: string) => void;
  onNotesFocus: () => void;
  onNotesBlur: () => void;
}) {
  return (
    <div className="settings-section settings-section-card">
      <div className="settings-section-title">{workspace.name}</div>
      <p className="settings-hint">{workspace.path}</p>
      <label className="settings-field" style={{ marginTop: '0.85rem' }}>
        Project context
        <textarea
          className="settings-history-search"
          rows={3}
          maxLength={2000}
          placeholder="Adds to account context — roles, tickets, and review queues for this repo"
          value={notesDraft}
          disabled={busy}
          onFocus={onNotesFocus}
          onChange={(e) => onNotesChange(e.target.value)}
          onBlur={onNotesBlur}
        />
      </label>
    </div>
  );
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
  /** Initial sidebar section (e.g. Issues from Create-from Linear setup). */
  initialNav?: NavId;
  /** Archived threads for Settings → History. */
  archived?: Thread[];
  onRestoreArchived?: (id: string) => void;
  onOpenArchived?: (id: string) => void;
  onPurgeArchived?: (id: string) => void;
  onClearOlderArchived?: (days: number) => Promise<{ purged: number } | void>;
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
      'Hosted chat via the Brightsy CLI (`brightsy login`) — no local file edits. Connect a team below for Brightsy schema and files. Slack (Remote) is how you remote-control this Mac.',
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
  initialNav = 'agents',
  archived = [],
  onRestoreArchived,
  onOpenArchived,
  onPurgeArchived,
  onClearOlderArchived,
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
  const [historyMaxCountDraft, setHistoryMaxCountDraft] = useState(String(HISTORY_MAX_COUNT_DEFAULT));
  const [historyMaxDaysDraft, setHistoryMaxDaysDraft] = useState('0');
  const [clearOlderDaysDraft, setClearOlderDaysDraft] = useState('365');
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [cliPathDraft, setCliPathDraft] = useState('');
  const [systemCliPath, setSystemCliPath] = useState<string | null>(null);
  const [brightsySession, setBrightsySession] = useState<BrightsySession | null>(null);
  const [defaultsPickerOpen, setDefaultsPickerOpen] = useState(false);
  const [orchDefaultsPickerOpen, setOrchDefaultsPickerOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [accountNotesDraft, setAccountNotesDraft] = useState('');
  const [projectNotesDrafts, setProjectNotesDrafts] = useState<Record<string, string>>({});
  const accountNotesFocused = useRef(false);
  const projectNotesFocused = useRef<string | null>(null);
  const [setupBusy, setSetupBusy] = useState<'install' | 'login' | null>(null);
  const [setupLog, setSetupLog] = useState<string | null>(null);
  const loginAbortRef = useRef<AbortController | null>(null);

  async function reload() {
    const [s, agents, session, listed] = await Promise.all([
      window.sideboard.getAppSettings(),
      window.sideboard.detectAgents(),
      window.sideboard.getBrightsySession().catch(() => null),
      window.sideboard.listWorkspaces().catch(() => [] as Workspace[]),
    ]);
    const next = normalizeSettings(s);
    setSettings(next);
    setMaxConcurrentDraft(String(s.advanced?.maxConcurrent ?? 5));
    setStatuses(agents);
    setBrightsySession(session);
    setWorkspaces(listed);
    if (!accountNotesFocused.current) {
      setAccountNotesDraft(next.defaults?.notes ?? '');
    }
    setProjectNotesDrafts((prev) => {
      const drafts: Record<string, string> = {};
      for (const ws of listed) {
        drafts[ws.path] =
          projectNotesFocused.current === ws.path
            ? (prev[ws.path] ?? next.projects?.[ws.path]?.notes ?? '')
            : (next.projects?.[ws.path]?.notes ?? '');
      }
      return drafts;
    });
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
      loginAbortRef.current?.abort();
      // Cancel in-flight OAuth only when Settings closes — not when switching
      // sidebar items, which unmount Issues/Remote while the browser flow is open.
      void window.sideboard.cancelLinearOAuth?.();
      void window.sideboard.cancelSlackOAuth?.();
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
    setHistoryMaxCountDraft(String(next.advanced?.historyMaxCount ?? HISTORY_MAX_COUNT_DEFAULT));
    setHistoryMaxDaysDraft(String(next.advanced?.historyMaxDays ?? 0));
    if (!accountNotesFocused.current) {
      setAccountNotesDraft(normalized.defaults?.notes ?? '');
    }
    onSettingsChange?.(normalized);
  }

  async function saveDefaultsPatch(patch: {
    agent?: AgentKind | null;
    model?: string | null;
    effort?: ThinkingEffort | null;
    notes?: string | null;
    orchestrator?: {
      agent?: AgentKind | null;
      model?: string | null;
      effort?: ThinkingEffort | null;
    } | null;
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

  async function saveProjectPatch(
    repoPath: string,
    patch: { notes?: string | null },
  ) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateProjectProfileSettings(repoPath, patch);
      applySettings(next);
      if (projectNotesFocused.current !== repoPath) {
        setProjectNotesDrafts((prev) => ({
          ...prev,
          [repoPath]: next.projects?.[repoPath]?.notes ?? '',
        }));
      }
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
  const hasOrchDefaults = Boolean(settings.defaults?.orchestrator);
  const orchDefaults = orchestratorDefaultsFromSettings(settings);
  const orchAgent = orchDefaults.agent;
  const orchModel = orchDefaults.model;
  const orchEffort = orchDefaults.effort;
  const deferredHistoryQuery = useDeferredValue(historyQuery);
  const filteredArchived = useMemo(() => {
    const q = deferredHistoryQuery.trim().toLowerCase();
    const list = [...archived].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return list;
    return list.filter((t) => {
      const repo = t.repoPath.split('/').filter(Boolean).pop() ?? t.repoPath;
      const hay =
        `${threadDisplayLabel(t)} ${t.title} ${t.branchName} ${t.agent} ${repo}`.toLowerCase();
      return hay.includes(q);
    });
  }, [archived, deferredHistoryQuery]);

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
              className={`settings-nav-btn${nav === 'projects' ? ' active' : ''}`}
              onClick={() => {
                setNav('projects');
                setAgentPanel(null);
              }}
            >
              Projects
            </button>
            <button
              type="button"
              className={`settings-nav-btn${nav === 'git' ? ' active' : ''}`}
              onClick={() => {
                setNav('git');
                setAgentPanel(null);
              }}
            >
              Git
            </button>
            <button
              type="button"
              className={`settings-nav-btn${nav === 'issues' ? ' active' : ''}`}
              onClick={() => {
                setNav('issues');
                setAgentPanel(null);
              }}
            >
              Issues
            </button>
            <button
              type="button"
              className={`settings-nav-btn${nav === 'remote' ? ' active' : ''}`}
              onClick={() => {
                setNav('remote');
                setAgentPanel(null);
              }}
            >
              Remote
            </button>
            <button
              type="button"
              className={`settings-nav-btn${nav === 'connectors' ? ' active' : ''}`}
              onClick={() => {
                setNav('connectors');
                setAgentPanel(null);
              }}
            >
              Connectors
            </button>
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
                {nav === 'agents'
                  ? activeAgent
                    ? activeAgent.label
                    : 'Agents'
                  : SETTINGS_NAV_TITLES[nav]}
              </h3>
              <button type="button" className="icon-btn" title="Close" onClick={onClose}>
                ✕
              </button>
            </div>

            {error && <div className="settings-error">{error}</div>}

            {nav === 'projects' && (
              <div className="settings-body">
                <p className="settings-lead">
                  Per-project context for finding tickets and review PRs. Adds to Settings →
                  Agents. Agents may propose updates; they ask you to confirm first.
                </p>
                {workspaces.length === 0 ? (
                  <p className="settings-hint">
                    No registered projects yet. Add a workspace from Home or Create.
                  </p>
                ) : (
                  workspaces.map((ws) => (
                    <ProjectProfileCard
                      key={ws.path}
                      workspace={ws}
                      notesDraft={projectNotesDrafts[ws.path] ?? ''}
                      busy={busy}
                      onNotesChange={(notes) =>
                        setProjectNotesDrafts((prev) => ({ ...prev, [ws.path]: notes }))
                      }
                      onNotesFocus={() => {
                        projectNotesFocused.current = ws.path;
                      }}
                      onNotesBlur={() => {
                        projectNotesFocused.current = null;
                        const next = (projectNotesDrafts[ws.path] ?? '').trim();
                        if (next === (settings.projects?.[ws.path]?.notes ?? '')) return;
                        void saveProjectPatch(ws.path, { notes: next || null });
                      }}
                    />
                  ))
                )}
              </div>
            )}

            {nav === 'git' && (
              <GitSettings
                settings={settings}
                applySettings={applySettings}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
              />
            )}

            {nav === 'issues' && (
              <IssuesSettings
                settings={settings}
                applySettings={applySettings}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
              />
            )}

            {nav === 'remote' && (
              <RemoteSettings
                settings={settings}
                applySettings={applySettings}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
              />
            )}

            {nav === 'connectors' && (
              <ConnectorsSettings
                settings={settings}
                applySettings={applySettings}
                busy={busy}
                setBusy={setBusy}
                setError={setError}
              />
            )}

            {nav === 'agents' && !activeAgent && (
              <div className="settings-body">
                <p className="settings-lead">
                  Default agent for new chats and a separate default for the orchestrator, then
                  account context for finding work. Credentials set here also appear under
                  Environment and are injected into agent runs.
                </p>
                <div className="settings-section settings-section-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-section-title">Default agent, model &amp; effort</div>
                      <p className="settings-hint">
                        Used for new workspace chats, chat tabs, and MCP-spawned worktrees (when
                        agent/model are omitted).
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
                      <div className="settings-section-title">
                        Default orchestrator agent, model &amp; effort
                      </div>
                      <p className="settings-hint">
                        Used for Global chats, Slack and cloud coordinators, and new orchestration
                        tabs. Unset inherits the defaults above.
                      </p>
                      <p className="settings-status-text" style={{ marginTop: 8 }}>
                        {hasOrchDefaults
                          ? defaultAgentModelLabel(orchAgent, orchModel, orchEffort)
                          : `Same as default (${defaultAgentModelLabel(orchAgent, orchModel, orchEffort)})`}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {hasOrchDefaults ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void saveDefaultsPatch({ orchestrator: null });
                          }}
                        >
                          Reset
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => setOrchDefaultsPickerOpen(true)}
                      >
                        Change
                      </button>
                    </div>
                  </div>
                </div>
                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Account context</div>
                  <p className="settings-hint">
                    How agents find your tickets and review PRs — roles, assignee rules, labels,
                    boards. A project can add more under Settings → Projects. Agents may propose
                    updates here; they ask you to confirm first.
                  </p>
                  <textarea
                    className="settings-history-search"
                    rows={4}
                    maxLength={2000}
                    aria-label="Account context"
                    placeholder="Engineering and design. Unassigned billing tickets; eng-review PRs"
                    value={accountNotesDraft}
                    disabled={busy}
                    onFocus={() => {
                      accountNotesFocused.current = true;
                    }}
                    onChange={(e) => setAccountNotesDraft(e.target.value)}
                    onBlur={() => {
                      accountNotesFocused.current = false;
                      const next = accountNotesDraft.trim();
                      if (next === (settings.defaults?.notes ?? '')) return;
                      void saveDefaultsPatch({ notes: next || null });
                    }}
                    style={{ marginTop: '0.65rem' }}
                  />
                </div>
                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">Follow-up behavior</div>
                  <p className="settings-hint">
                    When you send while an agent is already working. Steer (default) skips the
                    queue and adds the message to the chat immediately. Queue waits until the
                    current turn finishes.
                  </p>
                  <div className="settings-key-row" style={{ marginTop: '0.5rem', gap: '0.75rem' }}>
                    <label className="settings-hint" htmlFor="follow-up-behavior">
                      Default
                    </label>
                    <select
                      id="follow-up-behavior"
                      value={advanced.followUpBehavior ?? 'steer'}
                      disabled={busy}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== 'steer' && v !== 'queue') return;
                        void saveAdvancedPatch({ followUpBehavior: v });
                      }}
                    >
                      <option value="steer">Steer — send now, skip the queue</option>
                      <option value="queue">Queue — wait for the current turn</option>
                    </select>
                  </div>
                </div>
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
                      (Remote) is the remote path for this Mac.
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
                        <code>thread/&lt;team&gt;</code> branches to{' '}
                        <code>prefix/ticket-description</code> when Settings → Git has a
                        prefix; otherwise a short kebab-case task name.
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
                      <div className="settings-section-title">Limit archived history</div>
                      <p className="settings-hint">
                        Keep Settings → History from growing forever. Newest archived chats stay;
                        older ones lose their transcript, then the row. Off disables automatic
                        cleanup — Delete and Clear older than still work. Configure the cap on
                        History.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${advanced.autoCleanupHistory !== false ? ' on' : ''}`}
                      role="switch"
                      aria-checked={advanced.autoCleanupHistory !== false}
                      disabled={busy}
                      onClick={() =>
                        void saveAdvancedPatch({
                          autoCleanupHistory: advanced.autoCleanupHistory === false,
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
                  <div className="settings-section-title">On usage / session limit</div>
                  <p className="settings-hint">
                    When a Claude Code plan window is exhausted, or a worktree or orchestration
                    turn hits a provider session/usage limit (not context size). Applies to every
                    agent.
                  </p>
                  <div className="settings-key-row" style={{ marginTop: '0.5rem', gap: '0.75rem' }}>
                    <label className="settings-hint" htmlFor="usage-on-limit">
                      When over the limit
                    </label>
                    <select
                      id="usage-on-limit"
                      value={resolveUsageOnLimit(advanced)}
                      disabled={busy}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!isUsageOnLimit(v)) return;
                        void saveAdvancedPatch({ usageOnLimit: v });
                      }}
                    >
                      <option value="keep_going">Nothing — keep going</option>
                      <option value="confirm">Confirm with me</option>
                      <option value="switch_agent">Switch agent</option>
                      <option value="wait_reset">Stop until the window resets</option>
                    </select>
                  </div>
                  {resolveUsageOnLimit(advanced) === 'switch_agent' && (
                    <div
                      className="settings-key-row"
                      style={{ marginTop: '0.5rem', gap: '0.75rem' }}
                    >
                      <label className="settings-hint" htmlFor="usage-limit-fallback">
                        Fallback agent
                      </label>
                      <select
                        id="usage-limit-fallback"
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
                  it read-only from here. Delete removes the record (not the git branch).
                </p>
                <div className="settings-section settings-section-card">
                  <div className="settings-section-title">History cap</div>
                  <p className="settings-hint">
                    Keep at most this many archived chats (newest stay). Older rows lose their
                    transcript first, then the row. Days = 0 means no automatic age delete.
                    Automatic cleanup is the Advanced → Limit archived history switch
                    {advanced.autoCleanupHistory === false ? ' (currently off)' : ''}.
                  </p>
                  <div className="settings-key-row" style={{ marginTop: '0.65rem' }}>
                    <label className="settings-hint" htmlFor="history-max-count">
                      Keep at most
                    </label>
                    <input
                      id="history-max-count"
                      type="number"
                      min={HISTORY_MAX_COUNT_MIN}
                      max={HISTORY_MAX_COUNT_MAX}
                      step={1}
                      value={historyMaxCountDraft}
                      disabled={busy}
                      onChange={(e) => setHistoryMaxCountDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        busy ||
                        !historyMaxCountDraft.trim() ||
                        Number(historyMaxCountDraft) ===
                          (advanced.historyMaxCount ?? HISTORY_MAX_COUNT_DEFAULT)
                      }
                      onClick={() => {
                        const n = Number(historyMaxCountDraft);
                        if (!Number.isFinite(n)) {
                          setError('History cap must be a number');
                          return;
                        }
                        void saveAdvancedPatch({ historyMaxCount: n });
                      }}
                    >
                      Save
                    </button>
                  </div>
                  <div className="settings-key-row" style={{ marginTop: '0.5rem' }}>
                    <label className="settings-hint" htmlFor="history-max-days">
                      Delete after days
                    </label>
                    <input
                      id="history-max-days"
                      type="number"
                      min={0}
                      max={HISTORY_MAX_DAYS_MAX}
                      step={1}
                      value={historyMaxDaysDraft}
                      disabled={busy}
                      onChange={(e) => setHistoryMaxDaysDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        busy ||
                        historyMaxDaysDraft.trim() === '' ||
                        Number(historyMaxDaysDraft) === (advanced.historyMaxDays ?? 0)
                      }
                      onClick={() => {
                        const n = Number(historyMaxDaysDraft);
                        if (!Number.isFinite(n)) {
                          setError('History days must be a number');
                          return;
                        }
                        void saveAdvancedPatch({ historyMaxDays: n });
                      }}
                    >
                      Save
                    </button>
                  </div>
                  <div className="settings-key-row" style={{ marginTop: '0.5rem' }}>
                    <label className="settings-hint" htmlFor="history-clear-older">
                      Clear older than
                    </label>
                    <input
                      id="history-clear-older"
                      type="number"
                      min={1}
                      max={HISTORY_MAX_DAYS_MAX}
                      step={1}
                      value={clearOlderDaysDraft}
                      disabled={busy}
                      onChange={(e) => setClearOlderDaysDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="settings-history-delete"
                      disabled={busy || !clearOlderDaysDraft.trim()}
                      onClick={() => {
                        const days = Number(clearOlderDaysDraft);
                        if (!Number.isFinite(days) || days < 1) {
                          setError('Clear-older days must be at least 1');
                          return;
                        }
                        const count = planHistoryAgePurge(archived, days).length;
                        if (count === 0) {
                          setError(null);
                          return;
                        }
                        if (
                          !window.confirm(
                            `Delete ${count} archived chat${count === 1 ? '' : 's'} older than ${days} days? This cannot be undone.`,
                          )
                        ) {
                          return;
                        }
                        void Promise.resolve(onClearOlderArchived?.(days)).catch((err: unknown) => {
                          setError(err instanceof Error ? err.message : String(err));
                        });
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
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
                            <button
                              type="button"
                              className="settings-history-delete"
                              onClick={() => {
                                const label = threadDisplayLabel(t);
                                if (
                                  !window.confirm(
                                    `Delete “${label}” from History? The transcript is removed. The git branch is kept.`,
                                  )
                                ) {
                                  return;
                                }
                                onPurgeArchived?.(t.id);
                              }}
                            >
                              Delete
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
      <AgentOptionsPicker
        open={orchDefaultsPickerOpen}
        value={{
          agent: orchAgent,
          model: orchModel,
          autonomy: 'default' as Autonomy,
          effort: orchEffort,
        }}
        title="Default orchestrator agent, model & effort"
        confirmLabel="Save"
        allowedAgents={ORCHESTRATOR_AGENT_KINDS}
        onClose={() => setOrchDefaultsPickerOpen(false)}
        onApply={(next) => {
          void saveDefaultsPatch({
            orchestrator: {
              agent: next.agent,
              model: next.model,
              effort: next.effort,
            },
          });
        }}
      />
    </div>
  );
}
