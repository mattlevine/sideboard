import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentKind } from '../types/thread.js';
import { normalizeThinkingEffort, type ThinkingEffort } from '../types/thinking-effort.js';
import { appDataDir } from './paths.js';

/** Well-known env keys managed from Settings → Agents (Conductor-style harnesses). */
export const HARNESS_ENV_KEYS = {
  claude: 'ANTHROPIC_API_KEY',
  codex: 'CODEX_API_KEY',
  cursor: 'CURSOR_API_KEY',
  opencode: null,
  brightsy: null,
} as const;

export type HarnessId = keyof typeof HARNESS_ENV_KEYS;

const DEFAULT_AGENTS = new Set<AgentKind>([
  'claude',
  'codex',
  'opencode',
  'brightsy',
  'cursor',
]);

/**
 * Account-level defaults for Create / new chat tabs (Settings → Account).
 * Omitted fields fall back to Claude + Auto + High thinking at runtime.
 */
export interface DefaultsAppSettings {
  agent?: AgentKind;
  /** Model / Brightsy target id. Empty or omitted = Auto / agent default. */
  model?: string;
  /** Thinking / reasoning effort. Omitted = High. */
  effort?: ThinkingEffort;
  /**
   * Prefer a faster model variant when supported (Cursor `fast` param).
   * Independent of {@link DefaultsAppSettings.effort}.
   */
  fast?: boolean;
}

/** Claude Code harness options (executable override + Chrome). */
export interface ClaudeHarnessSettings {
  /** Absolute path to Claude Code. Empty/omitted = `claude` on PATH. */
  executablePath?: string;
  /** When true, pass `--chrome` on Claude turns. */
  chromeEnabled?: boolean;
}

/** Local agent that runs the Brightsy cloud coordinator. */
export type BrightsyCloudConnectAgent =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'cursor';

/** Brightsy cloud remote-orchestrator preferences (Slack / Discord / Teams). */
export interface BrightsyHarnessSettings {
  /** When true, desktop app polls Brightsy for Sideboard cloud tasks. */
  cloudConnectEnabled?: boolean;
  /** Local agent used for the cloud coordinator (not Brightsy itself). */
  cloudConnectAgent?: BrightsyCloudConnectAgent;
}

/** Preferred issue tracker for Create-from / Link issue. */
export type IssueSource = 'linear' | 'github';

/**
 * Sideboard-owned third-party connections (Account / Integrations).
 * GitHub uses machine `gh` auth; Linear uses a stored API key.
 */
export interface IntegrationsSettings {
  /** Linear personal API key (https://linear.app/settings/api). */
  linearApiKey?: string;
  /**
   * Preferred issue source for Create-from / Link issue (default: GitHub).
   * When `linear` but no API key, runtime falls back to GitHub Issues.
   */
  issueSource?: IssueSource;
}

/**
 * Conductor-inspired power-user preferences (Settings → Advanced).
 * Defaults match Conductor where applicable (auto-rename on, others off).
 */
export interface AdvancedAppSettings {
  /**
   * Ask the agent to rename the temporary `thread/<team>` branch on first send.
   * Conductor: Git → “Auto-rename placeholder branch on send” (default on).
   */
  autoRenameBranch?: boolean;
  /**
   * After workspace setup finishes, start the default run/dev script.
   * Conductor: `scripts.auto_run_after_setup` (default off).
   */
  autoRunAfterSetup?: boolean;
  /**
   * Keep the Mac awake with `caffeinate` while any agent turn is running.
   * Conductor: General → “Caffeinate while agents are running”.
   */
  caffeinateWhileRunning?: boolean;
  /**
   * Keep the Mac awake with `caffeinate` while Brightsy cloud connect is listening
   * (so Slack/Discord/Teams tasks can be polled). Default off.
   */
  caffeinateWhileCloudConnect?: boolean;
  /**
   * When purging a thread, also delete its git branch.
   * Conductor: `git.delete_branch_on_archive` (default off).
   */
  deleteBranchOnPurge?: boolean;
  /** Max concurrent agent turns across the orchestrator (default 3). */
  maxConcurrent?: number;
  /**
   * Max Sideboard worktrees kept machine-wide before orphan cleanup
   * (Cursor: cursor.worktreeMaxCount, default 25).
   */
  worktreeMaxCount?: number;
  /** Hours between automatic orphan worktree cleanup passes (default 6). */
  worktreeCleanupIntervalHours?: number;
  /** ISO timestamp of last successful orphan cleanup. */
  worktreeLastCleanupAt?: string;
  /** When true, reconcile auto-removes excess orphan worktrees. */
  autoCleanupOrphans?: boolean;
}

export interface AppSettings {
  /** Environment variables injected into agent / hook processes (and process.env). */
  environment: Record<string, string>;
  /** Claude Code–specific harness settings. */
  claude: ClaudeHarnessSettings;
  /** Brightsy cloud connect preferences (Slack / Discord / Teams). */
  brightsy: BrightsyHarnessSettings;
  /** GitHub / Linear connections and issue-source preference. */
  integrations: IntegrationsSettings;
  /** Default agent + model for new chats (Settings → Account). */
  defaults: DefaultsAppSettings;
  /** Power-user / Conductor-style advanced preferences. */
  advanced: AdvancedAppSettings;
}

export function appSettingsPath(): string {
  return join(appDataDir(), 'settings.json');
}

/** User-level Claude Code settings file (`~/.claude/settings.json`). */
export function claudeUserSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function normalizeClaude(raw: unknown): ClaudeHarnessSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: ClaudeHarnessSettings = {};
  if (typeof source.executablePath === 'string') {
    const path = source.executablePath.trim();
    if (path) out.executablePath = path;
  }
  if (typeof source.chromeEnabled === 'boolean') {
    out.chromeEnabled = source.chromeEnabled;
  }
  return out;
}

const CLOUD_CONNECT_AGENTS = new Set<BrightsyCloudConnectAgent>([
  'claude',
  'codex',
  'opencode',
  'cursor',
]);

function normalizeBrightsy(raw: unknown): BrightsyHarnessSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: BrightsyHarnessSettings = {};
  if (typeof source.cloudConnectEnabled === 'boolean') {
    out.cloudConnectEnabled = source.cloudConnectEnabled;
  }
  if (
    typeof source.cloudConnectAgent === 'string' &&
    CLOUD_CONNECT_AGENTS.has(source.cloudConnectAgent as BrightsyCloudConnectAgent)
  ) {
    out.cloudConnectAgent = source.cloudConnectAgent as BrightsyCloudConnectAgent;
  }
  return out;
}

const ISSUE_SOURCES = new Set<IssueSource>(['linear', 'github']);

function normalizeIntegrations(raw: unknown): IntegrationsSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: IntegrationsSettings = {};
  if (typeof source.linearApiKey === 'string') {
    const key = source.linearApiKey.trim();
    if (key) out.linearApiKey = key;
  }
  if (
    typeof source.issueSource === 'string' &&
    ISSUE_SOURCES.has(source.issueSource as IssueSource)
  ) {
    out.issueSource = source.issueSource as IssueSource;
  }
  return out;
}

function normalizeDefaults(raw: unknown): DefaultsAppSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: DefaultsAppSettings = {};
  if (
    typeof source.agent === 'string' &&
    DEFAULT_AGENTS.has(source.agent as AgentKind)
  ) {
    out.agent = source.agent as AgentKind;
  }
  if (typeof source.model === 'string') {
    const model = source.model.trim();
    if (model) out.model = model;
  }
  if (normalizeThinkingEffort(source.effort)) {
    out.effort = normalizeThinkingEffort(source.effort)!;
  }
  if (typeof source.fast === 'boolean') {
    out.fast = source.fast;
  }
  return out;
}

function normalizeAdvanced(raw: unknown): AdvancedAppSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: AdvancedAppSettings = {};
  if (typeof source.autoRenameBranch === 'boolean') {
    out.autoRenameBranch = source.autoRenameBranch;
  }
  if (typeof source.autoRunAfterSetup === 'boolean') {
    out.autoRunAfterSetup = source.autoRunAfterSetup;
  }
  if (typeof source.caffeinateWhileRunning === 'boolean') {
    out.caffeinateWhileRunning = source.caffeinateWhileRunning;
  }
  if (typeof source.caffeinateWhileCloudConnect === 'boolean') {
    out.caffeinateWhileCloudConnect = source.caffeinateWhileCloudConnect;
  }
  if (typeof source.deleteBranchOnPurge === 'boolean') {
    out.deleteBranchOnPurge = source.deleteBranchOnPurge;
  }
  if (typeof source.maxConcurrent === 'number' && Number.isFinite(source.maxConcurrent)) {
    out.maxConcurrent = Math.max(1, Math.min(32, Math.floor(source.maxConcurrent)));
  }
  if (typeof source.worktreeMaxCount === 'number' && Number.isFinite(source.worktreeMaxCount)) {
    out.worktreeMaxCount = Math.max(1, Math.min(500, Math.floor(source.worktreeMaxCount)));
  }
  if (
    typeof source.worktreeCleanupIntervalHours === 'number' &&
    Number.isFinite(source.worktreeCleanupIntervalHours)
  ) {
    out.worktreeCleanupIntervalHours = Math.max(
      1,
      Math.min(168, Math.floor(source.worktreeCleanupIntervalHours)),
    );
  }
  if (typeof source.worktreeLastCleanupAt === 'string' && source.worktreeLastCleanupAt.trim()) {
    out.worktreeLastCleanupAt = source.worktreeLastCleanupAt.trim();
  }
  if (typeof source.autoCleanupOrphans === 'boolean') {
    out.autoCleanupOrphans = source.autoCleanupOrphans;
  }
  return out;
}

function normalizeSettings(raw: unknown): AppSettings {
  const env: Record<string, string> = {};
  let claude: ClaudeHarnessSettings = {};
  let brightsy: BrightsyHarnessSettings = {};
  let integrations: IntegrationsSettings = {};
  let defaults: DefaultsAppSettings = {};
  let advanced: AdvancedAppSettings = {};
  if (raw && typeof raw === 'object') {
    if ('environment' in raw) {
      const source = (raw as { environment?: unknown }).environment;
      if (source && typeof source === 'object') {
        for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
          const key = k.trim();
          if (!key) continue;
          if (typeof v === 'string' && v.length > 0) env[key] = v;
        }
      }
    }
    if ('claude' in raw) {
      claude = normalizeClaude((raw as { claude?: unknown }).claude);
    }
    if ('brightsy' in raw) {
      brightsy = normalizeBrightsy((raw as { brightsy?: unknown }).brightsy);
    }
    if ('integrations' in raw) {
      integrations = normalizeIntegrations(
        (raw as { integrations?: unknown }).integrations,
      );
    }
    if ('defaults' in raw) {
      defaults = normalizeDefaults((raw as { defaults?: unknown }).defaults);
    }
    if ('advanced' in raw) {
      advanced = normalizeAdvanced((raw as { advanced?: unknown }).advanced);
    }
  }
  return { environment: env, claude, brightsy, integrations, defaults, advanced };
}

const EMPTY_SETTINGS: AppSettings = {
  environment: {},
  claude: {},
  brightsy: {},
  integrations: {},
  defaults: {},
  advanced: {},
};

export function loadAppSettings(): AppSettings {
  const path = appSettingsPath();
  if (!existsSync(path)) {
    return { ...EMPTY_SETTINGS };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return normalizeSettings(parsed);
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(appSettingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export function updateAppEnvironment(
  patch: Record<string, string | null | undefined>,
): AppSettings {
  const current = loadAppSettings();
  const environment = { ...current.environment };
  for (const [key, value] of Object.entries(patch)) {
    const k = key.trim();
    if (!k) continue;
    if (value == null || value === '') {
      delete environment[k];
    } else {
      environment[k] = value;
    }
  }
  return saveAppSettings({ ...current, environment });
}

export function updateClaudeSettings(
  patch: {
    executablePath?: string | null;
    chromeEnabled?: boolean;
  },
): AppSettings {
  const current = loadAppSettings();
  const claude: ClaudeHarnessSettings = { ...current.claude };
  if ('executablePath' in patch) {
    if (patch.executablePath == null || patch.executablePath.trim() === '') {
      delete claude.executablePath;
    } else {
      claude.executablePath = patch.executablePath.trim();
    }
  }
  if (typeof patch.chromeEnabled === 'boolean') {
    claude.chromeEnabled = patch.chromeEnabled;
  }
  return saveAppSettings({ ...current, claude });
}

export function updateBrightsySettings(
  patch: {
    cloudConnectEnabled?: boolean;
    cloudConnectAgent?: BrightsyCloudConnectAgent | null;
  },
): AppSettings {
  const current = loadAppSettings();
  const brightsy: BrightsyHarnessSettings = { ...current.brightsy };
  if (typeof patch.cloudConnectEnabled === 'boolean') {
    brightsy.cloudConnectEnabled = patch.cloudConnectEnabled;
  }
  if ('cloudConnectAgent' in patch) {
    if (patch.cloudConnectAgent == null) {
      delete brightsy.cloudConnectAgent;
    } else if (CLOUD_CONNECT_AGENTS.has(patch.cloudConnectAgent)) {
      brightsy.cloudConnectAgent = patch.cloudConnectAgent;
    }
  }
  return saveAppSettings({ ...current, brightsy });
}

export function updateIntegrationsSettings(
  patch: {
    linearApiKey?: string | null;
    issueSource?: IssueSource | null;
  },
): AppSettings {
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  if ('linearApiKey' in patch) {
    if (patch.linearApiKey == null || patch.linearApiKey.trim() === '') {
      delete integrations.linearApiKey;
    } else {
      integrations.linearApiKey = patch.linearApiKey.trim();
    }
  }
  if ('issueSource' in patch) {
    if (patch.issueSource == null) {
      delete integrations.issueSource;
    } else if (ISSUE_SOURCES.has(patch.issueSource)) {
      integrations.issueSource = patch.issueSource;
    }
  }
  return saveAppSettings({ ...current, integrations });
}

export function updateDefaultsSettings(
  patch: {
    agent?: AgentKind | null;
    model?: string | null;
    /** Effort level, or Conductor's `normal` (stored as medium). */
    effort?: ThinkingEffort | 'normal' | null;
    fast?: boolean | null;
  },
): AppSettings {
  const current = loadAppSettings();
  const defaults: DefaultsAppSettings = { ...current.defaults };
  if ('agent' in patch) {
    if (patch.agent == null) {
      delete defaults.agent;
    } else if (DEFAULT_AGENTS.has(patch.agent)) {
      defaults.agent = patch.agent;
    }
  }
  if ('model' in patch) {
    if (patch.model == null || patch.model.trim() === '') {
      delete defaults.model;
    } else {
      defaults.model = patch.model.trim();
    }
  }
  if ('effort' in patch) {
    if (patch.effort == null) {
      delete defaults.effort;
    } else {
      const effort = normalizeThinkingEffort(patch.effort);
      if (effort) defaults.effort = effort;
    }
  }
  if ('fast' in patch) {
    if (patch.fast == null) {
      delete defaults.fast;
    } else {
      defaults.fast = Boolean(patch.fast);
    }
  }
  return saveAppSettings({ ...current, defaults });
}

/** Default agent for Create / new chats (claude when unset). */
export function getDefaultAgent(
  settings: AppSettings = loadAppSettings(),
): AgentKind {
  return settings.defaults.agent ?? 'claude';
}

/** Default model id for Create / new chats (`null` = Auto / agent default). */
export function getDefaultModel(
  settings: AppSettings = loadAppSettings(),
): string | null {
  const model = settings.defaults.model?.trim();
  return model || null;
}

/** Default thinking effort for Create / new chats (`high` when unset). */
export function getDefaultEffort(
  settings: AppSettings = loadAppSettings(),
): ThinkingEffort {
  return normalizeThinkingEffort(settings.defaults.effort) ?? 'high';
}

/** Default fast-mode flag for Create / new chats (`true` = Fast). */
export function getDefaultFast(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return settings.defaults.fast === true;
}

/** Resolved Create / new-chat agent + model + thinking defaults. */
export function resolveThreadDefaults(
  settings: AppSettings = loadAppSettings(),
): { agent: AgentKind; model: string | null; effort: ThinkingEffort; fast: boolean } {
  return {
    agent: getDefaultAgent(settings),
    model: getDefaultModel(settings),
    effort: getDefaultEffort(settings),
    fast: getDefaultFast(settings),
  };
}

/** True when Sideboard has a Linear API key stored. */
export function isLinearConnected(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.integrations.linearApiKey?.trim());
}

/** Preferred issue source (default GitHub). */
export function getIssueSource(
  settings: AppSettings = loadAppSettings(),
): IssueSource {
  return settings.integrations.issueSource ?? 'github';
}

/**
 * Runtime issue source: honors preference, but falls back to GitHub when
 * Linear is preferred and not connected.
 */
export function resolveEffectiveIssueSource(
  settings: AppSettings = loadAppSettings(),
): IssueSource {
  const preferred = getIssueSource(settings);
  if (preferred === 'linear' && !isLinearConnected(settings)) return 'github';
  return preferred;
}

export function getLinearApiKey(
  settings: AppSettings = loadAppSettings(),
): string | null {
  const key = settings.integrations.linearApiKey?.trim();
  return key || null;
}

export function brightsyCloudConnectEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.brightsy.cloudConnectEnabled);
}

export function brightsyCloudConnectAgent(
  settings: AppSettings = loadAppSettings(),
): BrightsyCloudConnectAgent {
  return settings.brightsy.cloudConnectAgent ?? 'claude';
}

export function updateAdvancedSettings(
  patch: Partial<AdvancedAppSettings>,
): AppSettings {
  const current = loadAppSettings();
  const advanced: AdvancedAppSettings = { ...current.advanced };
  if (typeof patch.autoRenameBranch === 'boolean') {
    advanced.autoRenameBranch = patch.autoRenameBranch;
  }
  if (typeof patch.autoRunAfterSetup === 'boolean') {
    advanced.autoRunAfterSetup = patch.autoRunAfterSetup;
  }
  if (typeof patch.caffeinateWhileRunning === 'boolean') {
    advanced.caffeinateWhileRunning = patch.caffeinateWhileRunning;
  }
  if (typeof patch.caffeinateWhileCloudConnect === 'boolean') {
    advanced.caffeinateWhileCloudConnect = patch.caffeinateWhileCloudConnect;
  }
  if (typeof patch.deleteBranchOnPurge === 'boolean') {
    advanced.deleteBranchOnPurge = patch.deleteBranchOnPurge;
  }
  if (typeof patch.maxConcurrent === 'number' && Number.isFinite(patch.maxConcurrent)) {
    advanced.maxConcurrent = Math.max(1, Math.min(32, Math.floor(patch.maxConcurrent)));
  }
  if (typeof patch.worktreeMaxCount === 'number' && Number.isFinite(patch.worktreeMaxCount)) {
    advanced.worktreeMaxCount = Math.max(1, Math.min(500, Math.floor(patch.worktreeMaxCount)));
  }
  if (
    typeof patch.worktreeCleanupIntervalHours === 'number' &&
    Number.isFinite(patch.worktreeCleanupIntervalHours)
  ) {
    advanced.worktreeCleanupIntervalHours = Math.max(
      1,
      Math.min(168, Math.floor(patch.worktreeCleanupIntervalHours)),
    );
  }
  if (typeof patch.worktreeLastCleanupAt === 'string') {
    advanced.worktreeLastCleanupAt = patch.worktreeLastCleanupAt;
  }
  if (typeof patch.autoCleanupOrphans === 'boolean') {
    advanced.autoCleanupOrphans = patch.autoCleanupOrphans;
  }
  return saveAppSettings({ ...current, advanced });
}

/** Conductor default: on. */
export function autoRenameBranchEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return settings.advanced.autoRenameBranch !== false;
}

export function autoRunAfterSetupEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.autoRunAfterSetup);
}

export function caffeinateWhileRunningEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.caffeinateWhileRunning);
}

export function caffeinateWhileCloudConnectEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.caffeinateWhileCloudConnect);
}

export function deleteBranchOnPurgeEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.deleteBranchOnPurge);
}

export function autoCleanupOrphansEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.autoCleanupOrphans);
}

export function maxConcurrentAgents(
  settings: AppSettings = loadAppSettings(),
): number {
  const n = settings.advanced.maxConcurrent;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return Math.max(1, Math.min(32, Math.floor(n)));
  }
  return 3;
}

/** Binary name or absolute path used to spawn Claude Code. */
export function resolveClaudeExecutable(
  settings: AppSettings = loadAppSettings(),
): string {
  const override = settings.claude.executablePath?.trim();
  return override || 'claude';
}

export function claudeChromeEnabled(settings: AppSettings = loadAppSettings()): boolean {
  return Boolean(settings.claude.chromeEnabled);
}

/**
 * Apply Sideboard-managed environment onto a process env object.
 * Does not overwrite keys already set in the host environment (shell wins),
 * matching Conductor's "shell or Settings" layering for credentials.
 */
export function applyAppEnvironment(
  target: NodeJS.ProcessEnv = process.env,
  settings: AppSettings = loadAppSettings(),
): NodeJS.ProcessEnv {
  for (const [key, value] of Object.entries(settings.environment)) {
    if (!key || value == null || value === '') continue;
    if (target[key] == null || target[key] === '') {
      target[key] = value;
    }
  }
  return target;
}

/** Env for a child process: host env + Sideboard settings (settings fill gaps). */
export function childEnvWithAppSettings(
  extra?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const settings = loadAppSettings();
  const env: NodeJS.ProcessEnv = { ...process.env };
  applyAppEnvironment(env, settings);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null) env[k] = v;
    }
  }
  return env;
}

export function harnessEnvKey(harness: HarnessId): string | null {
  return HARNESS_ENV_KEYS[harness];
}
