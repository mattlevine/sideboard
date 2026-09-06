import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { AgentKind } from '../types/thread.js';
import { normalizeThinkingEffort, type ThinkingEffort } from '../types/thinking-effort.js';
import { stripNestedElectronEnv } from '../hook/nested-electron-env.js';
import {
  foldLegacyRolesIntoNotes,
  normalizeProfileNotes,
  resolveViewerProfile,
} from './account-profile.js';
import { appDataDir } from './paths.js';
import { chmodOwnerOnly, writePrivateFile } from './private-file.js';
import { loadSecretVault, saveSecretVault } from './secret-vault.js';

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
 * App-level defaults for Create / new chat tabs (Settings → Agents).
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
  /**
   * Account context (Settings → Agents): roles, tickets, review queues.
   * Project context (Settings → Projects) adds for that repo.
   */
  notes?: string;
  /** @deprecated Folded into {@link DefaultsAppSettings.notes} on read. */
  roles?: string[];
  /** @deprecated Folded into {@link DefaultsAppSettings.notes} on read. */
  role?: string;
}

/** Per-repo context (Settings → Projects). Adds to account context. */
export interface ProjectProfileSettings {
  notes?: string;
  /** @deprecated Folded into {@link ProjectProfileSettings.notes} on read. */
  roles?: string[];
  /** @deprecated Folded into {@link ProjectProfileSettings.notes} on read. */
  role?: string;
}

/** Claude Code harness options (executable override + Chrome). */
export interface ClaudeHarnessSettings {
  /** Absolute path to Claude Code. Empty/omitted = `claude` on PATH. */
  executablePath?: string;
  /** When true, pass `--chrome` on Claude turns. */
  chromeEnabled?: boolean;
}

/** Optional absolute path override for a CLI agent binary. */
export interface CliExecutableSettings {
  /** Absolute path to the CLI. Empty/omitted = default name on PATH. */
  executablePath?: string;
}

/** Local agent that runs the Brightsy cloud coordinator. */
export type BrightsyCloudConnectAgent =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'cursor';

/** Brightsy cloud remote-orchestrator preferences. */
export interface BrightsyHarnessSettings {
  /** Absolute path to the Brightsy CLI. Empty/omitted = `brightsy` on PATH. */
  executablePath?: string;
  /** When true, desktop app polls Brightsy for Sideboard cloud tasks. */
  cloudConnectEnabled?: boolean;
  /** Local agent used for the cloud coordinator (not Brightsy itself). */
  cloudConnectAgent?: BrightsyCloudConnectAgent;
  /**
   * When true, inject Brightsy MCP on every worktree agent turn (Claude / Codex /
   * Cursor / OpenCode) if logged in. Default off: only when the user asks
   * (“use Brightsy…”) or the thread already used it. Orchestration always injects.
   */
  injectWorktreeMcp?: boolean;
}

/** Preferred issue tracker for Create-from / Link issue / Home Backlog. */
export type IssueSource = 'linear' | 'github' | 'abletime';

export {
  ISSUE_SOURCE_LABELS,
  issueSourceLabel,
} from './issue-source-labels.js';

/**
 * How Sideboard and worktree agents authenticate GitHub git operations.
 * A declared mode so the app and injected prompts agree. Sideboard never
 * uses a third-party GitHub App (including Conductor.build) for git auth.
 * - `auto` (default): HTTPS in the agent process using this Mac’s gh token (no Keychain after app start)
 * - `gh`: same HTTPS rewrite; token warmed into a credential store (not `GH_TOKEN` in agent env)
 * - `ssh`: keep `git@` remotes; batch-mode SSH (no Keychain dialog — fails if agent locked)
 * - `token`: stored PAT warmed into the same credential store + HTTPS rewrite
 */
export type GithubGitAuthMode = 'auto' | 'gh' | 'ssh' | 'token';

export const GITHUB_GIT_AUTH_MODES = ['auto', 'gh', 'ssh', 'token'] as const;

/**
 * Sideboard-owned third-party connections (Account / Integrations).
 * GitHub uses a declared git-auth mode (`gh` / SSH / PAT); Linear uses OAuth
 * (or a stored API key).
 */
export interface IntegrationsSettings {
  /** Linear personal API key (https://linear.app/settings/api). Fallback when OAuth is unused. */
  linearApiKey?: string;
  /** Linear OAuth access token (Settings → Issues → Linear → Connect via browser). */
  linearAccessToken?: string;
  /** Linear OAuth refresh token (rotated on each refresh). */
  linearRefreshToken?: string;
  /** Epoch ms when {@link IntegrationsSettings.linearAccessToken} expires. */
  linearTokenExpiresAt?: number;
  /** Linear OAuth app Client ID override (else baked / env). */
  linearClientId?: string;
  /** Linear OAuth app Client Secret override (optional with PKCE). */
  linearClientSecret?: string;
  /** Display name of the connected Linear user (non-secret). */
  linearViewerName?: string;
  /** Display name of the connected Linear workspace (non-secret). */
  linearOrganizationName?: string;
  /**
   * Preferred issue source for Create-from / Link issue / Home (default: GitHub).
   * When the preferred tracker is not connected, runtime falls back to GitHub Issues.
   */
  issueSource?: IssueSource;
  /** Slack app Client ID for browser OAuth (Settings → Remote → Slack). */
  slackClientId?: string;
  /** Slack app Client Secret for browser OAuth. */
  slackClientSecret?: string;
  /**
   * Slack app-level token (`xapp-…`, `connections:write`) for Socket Mode listen.
   * App-wide — not per workspace.
   */
  slackAppToken?: string;
  /** When true, desktop/CLI listen for Slack DMs and @mentions via Socket Mode. */
  slackListenEnabled?: boolean;
  /**
   * Stable per-Mac id for the Slack relay (Personal vs Work can both stay online).
   * Generated once; do not copy between machines.
   */
  slackDeviceId?: string;
  /** Human label for this Mac destination, e.g. Personal / Work. */
  slackDeviceLabel?: string;
  /**
   * How agents and Sideboard git helpers authenticate GitHub.
   * Omitted = {@link getGithubGitAuthMode} default (`auto`).
   */
  githubGitAuthMode?: GithubGitAuthMode;
  /** Fine-grained or classic PAT when mode is `token` (vaulted). */
  githubPat?: string;
  /**
   * AbleTime personal access token (`apt_…`) for hosted MCP
   * (`POST {host}/api/public/v2/mcp`). Vaulted.
   */
  abletimeAccessToken?: string;
  /** AbleTime host (default https://track.abletime.com). */
  abletimeHost?: string;
  /** Display name of the connected AbleTime user (non-secret). */
  abletimeViewerName?: string;
  /** Vercel personal token (vaulted). Injected as VERCEL_TOKEN. */
  vercelToken?: string;
  /** Display name of the connected Vercel user (non-secret). */
  vercelViewerName?: string;
  /** Supabase personal access token (vaulted). Injected as SUPABASE_ACCESS_TOKEN. */
  supabaseAccessToken?: string;
  /** Display name of the connected Supabase org (non-secret). */
  supabaseViewerName?: string;
  /** PostHog personal API key (vaulted). Injected as POSTHOG_PERSONAL_API_KEY. */
  posthogPersonalApiKey?: string;
  /** PostHog API host (default https://us.posthog.com). */
  posthogHost?: string;
  /** Display name of the connected PostHog user (non-secret). */
  posthogViewerName?: string;
  /** Sentry auth token (vaulted). Injected as SENTRY_AUTH_TOKEN. */
  sentryAuthToken?: string;
  /** Sentry API host (default https://sentry.io). */
  sentryHost?: string;
  /** Display name of the connected Sentry org (non-secret). */
  sentryViewerName?: string;
}

/**
 * Conductor-inspired power-user preferences (Settings → Advanced).
 * Defaults match Conductor where applicable (auto-rename on, others off).
 */
export type OrchestrationQuotaOnLimit = 'switch_agent' | 'wait_reset';

/**
 * How a follow-up send behaves while a turn is already in flight.
 * Conductor: Settings → General → Follow-up behavior (default steer).
 * - `steer` (default): skip the queue — interrupt and start the new prompt now
 * - `queue`: wait behind the current turn (and any already-queued follow-ups)
 */
export type FollowUpBehavior = 'queue' | 'steer';

export const FOLLOW_UP_BEHAVIORS = ['steer', 'queue'] as const;

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
   * Keep the Mac awake with `caffeinate` while Slack Listen is connected
   * (so Personal/Work stay reachable with the lid closed on AC). Default off.
   */
  caffeinateWhileSlackListen?: boolean;
  /**
   * Keep the Mac awake with `caffeinate` while any local schedule is enabled
   * (so a due job can fire). Default off — a 9am cron should not pin the Mac
   * awake 24/7 unless the user opts in.
   */
  caffeinateWhileSchedules?: boolean;
  /**
   * @deprecated Prefer `caffeinateWhileSlackListen`. Still read on load for migration.
   */
  caffeinateWhileCloudConnect?: boolean;
  /**
   * When purging a thread, also delete its git branch.
   * Conductor: `git.delete_branch_on_archive` (default off).
   */
  deleteBranchOnPurge?: boolean;
  /**
   * Allow chats that work in the project folder on the default branch
   * (no `thread/*` worktree). Land is commit+push to that branch.
   * Default off — turn on in Settings → Advanced.
   */
  cowboyMode?: boolean;
  /**
   * Show provider-reported USD cost on message chips, thread Σ, and sidebar
   * hover spend. Default off — turn on in Settings → Advanced.
   */
  showCost?: boolean;
  /**
   * When a linked PR becomes MERGED, archive the worktree’s chats.
   * Conductor: auto-archive on merge (opt-in; default off).
   */
  autoArchiveOnMerge?: boolean;
  /** Max concurrent agent turns across the orchestrator (default 5). */
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
  /**
   * When an orchestration chat hits a provider session/usage limit:
   * - `switch_agent` (default): continue on {@link AdvancedAppSettings.orchestrationQuotaFallbackAgent} with Auto
   * - `wait_reset`: schedule auto-retry when the limit message’s reset time arrives
   */
  orchestrationQuotaOnLimit?: OrchestrationQuotaOnLimit;
  /** Agent to continue on after a session limit (default: cursor). Ignored when equal to the limited agent. */
  orchestrationQuotaFallbackAgent?: AgentKind;
  /**
   * Follow-up send while a turn is running.
   * Omitted = {@link followUpBehavior} default (`steer`).
   */
  followUpBehavior?: FollowUpBehavior;
}

export interface AppSettings {
  /** Environment variables injected into agent / hook processes (and process.env). */
  environment: Record<string, string>;
  /** Claude Code–specific harness settings. */
  claude: ClaudeHarnessSettings;
  /** Codex CLI executable override. */
  codex: CliExecutableSettings;
  /** OpenCode CLI executable override. */
  opencode: CliExecutableSettings;
  /** Brightsy cloud connect preferences. */
  brightsy: BrightsyHarnessSettings;
  /** GitHub / Linear connections and issue-source preference. */
  integrations: IntegrationsSettings;
  /** Default agent + model for new chats (Settings → Agents). */
  defaults: DefaultsAppSettings;
  /**
   * Per-workspace viewer context (Settings → Projects), keyed by repo path.
   * Notes add to account context (Settings → Agents).
   */
  projects: Record<string, ProjectProfileSettings>;
  /** Power-user / Conductor-style advanced preferences. */
  advanced: AdvancedAppSettings;
}

/** Integrations fields safe to send to the renderer (no token values). */
export type PublicIntegrationsSettings = Omit<
  IntegrationsSettings,
  | 'linearApiKey'
  | 'linearAccessToken'
  | 'linearRefreshToken'
  | 'linearClientSecret'
  | 'slackClientSecret'
  | 'slackAppToken'
  | 'githubPat'
  | 'abletimeAccessToken'
  | 'vercelToken'
  | 'supabaseAccessToken'
  | 'posthogPersonalApiKey'
  | 'sentryAuthToken'
> & {
  /** True when Linear is connected (OAuth or API key). */
  hasLinearApiKey: boolean;
  hasLinearOAuth: boolean;
  hasSlackClientSecret: boolean;
  hasSlackAppToken: boolean;
  /** True when a GitHub PAT is stored (token mode). */
  hasGithubPat: boolean;
  /** True when an AbleTime personal access token is stored. */
  hasAbleTimeToken: boolean;
  hasVercelToken: boolean;
  hasSupabaseToken: boolean;
  hasPosthogToken: boolean;
  hasSentryToken: boolean;
};

/** Renderer / empty-state flags (no token values). */
export function emptyPublicIntegrations(): PublicIntegrationsSettings {
  return {
    hasLinearApiKey: false,
    hasLinearOAuth: false,
    hasSlackClientSecret: false,
    hasSlackAppToken: false,
    hasGithubPat: false,
    hasAbleTimeToken: false,
    hasVercelToken: false,
    hasSupabaseToken: false,
    hasPosthogToken: false,
    hasSentryToken: false,
  };
}

/** Settings payload for the desktop UI. Secret values are omitted. */
export type PublicAppSettings = Omit<AppSettings, 'integrations'> & {
  integrations: PublicIntegrationsSettings;
};

function hasLinearOAuth(integrations: IntegrationsSettings): boolean {
  return Boolean(
    integrations.linearAccessToken?.trim() || integrations.linearRefreshToken?.trim(),
  );
}

function hasLinearCredentials(integrations: IntegrationsSettings): boolean {
  return Boolean(integrations.linearApiKey?.trim()) || hasLinearOAuth(integrations);
}

export function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  const environment: Record<string, string> = {};
  for (const key of Object.keys(settings.environment)) {
    if (key.trim()) environment[key] = '';
  }
  const integrations: IntegrationsSettings = { ...settings.integrations };
  const slackClientSecret = integrations.slackClientSecret;
  const slackAppToken = integrations.slackAppToken;
  const githubPat = integrations.githubPat;
  const abletimeAccessToken = integrations.abletimeAccessToken;
  const vercelToken = integrations.vercelToken;
  const supabaseAccessToken = integrations.supabaseAccessToken;
  const posthogPersonalApiKey = integrations.posthogPersonalApiKey;
  const sentryAuthToken = integrations.sentryAuthToken;
  delete integrations.linearApiKey;
  delete integrations.linearAccessToken;
  delete integrations.linearRefreshToken;
  delete integrations.linearClientSecret;
  delete integrations.slackClientSecret;
  delete integrations.slackAppToken;
  delete integrations.githubPat;
  delete integrations.abletimeAccessToken;
  delete integrations.vercelToken;
  delete integrations.supabaseAccessToken;
  delete integrations.posthogPersonalApiKey;
  delete integrations.sentryAuthToken;
  return {
    ...settings,
    environment,
    integrations: {
      ...integrations,
      hasLinearApiKey: hasLinearCredentials(settings.integrations),
      hasLinearOAuth: hasLinearOAuth(settings.integrations),
      hasSlackClientSecret: Boolean(slackClientSecret?.trim()),
      hasSlackAppToken: Boolean(slackAppToken?.trim()),
      hasGithubPat: Boolean(githubPat?.trim()),
      hasAbleTimeToken: Boolean(abletimeAccessToken?.trim()),
      hasVercelToken: Boolean(vercelToken?.trim()),
      hasSupabaseToken: Boolean(supabaseAccessToken?.trim()),
      hasPosthogToken: Boolean(posthogPersonalApiKey?.trim()),
      hasSentryToken: Boolean(sentryAuthToken?.trim()),
    },
  };
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

function normalizeCliExecutable(raw: unknown): CliExecutableSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: CliExecutableSettings = {};
  if (typeof source.executablePath === 'string') {
    const path = source.executablePath.trim();
    if (path) out.executablePath = path;
  }
  return out;
}

function normalizeBrightsy(raw: unknown): BrightsyHarnessSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: BrightsyHarnessSettings = {};
  if (typeof source.executablePath === 'string') {
    const path = source.executablePath.trim();
    if (path) out.executablePath = path;
  }
  if (typeof source.cloudConnectEnabled === 'boolean') {
    out.cloudConnectEnabled = source.cloudConnectEnabled;
  }
  if (
    typeof source.cloudConnectAgent === 'string' &&
    CLOUD_CONNECT_AGENTS.has(source.cloudConnectAgent as BrightsyCloudConnectAgent)
  ) {
    out.cloudConnectAgent = source.cloudConnectAgent as BrightsyCloudConnectAgent;
  }
  if (typeof source.injectWorktreeMcp === 'boolean') {
    out.injectWorktreeMcp = source.injectWorktreeMcp;
  }
  return out;
}

const ISSUE_SOURCES = new Set<IssueSource>(['linear', 'github', 'abletime']);
const GIT_AUTH_MODES = new Set<GithubGitAuthMode>(GITHUB_GIT_AUTH_MODES);

function normalizeIntegrations(raw: unknown): IntegrationsSettings {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: IntegrationsSettings = {};
  if (typeof source.linearApiKey === 'string') {
    const key = source.linearApiKey.trim();
    if (key) out.linearApiKey = key;
  }
  if (typeof source.linearAccessToken === 'string') {
    const token = source.linearAccessToken.trim();
    if (token) out.linearAccessToken = token;
  }
  if (typeof source.linearRefreshToken === 'string') {
    const token = source.linearRefreshToken.trim();
    if (token) out.linearRefreshToken = token;
  }
  if (typeof source.linearTokenExpiresAt === 'number' && Number.isFinite(source.linearTokenExpiresAt)) {
    out.linearTokenExpiresAt = source.linearTokenExpiresAt;
  } else if (typeof source.linearTokenExpiresAt === 'string') {
    const n = Number(source.linearTokenExpiresAt);
    if (Number.isFinite(n)) out.linearTokenExpiresAt = n;
  }
  if (typeof source.linearClientId === 'string') {
    const id = source.linearClientId.trim();
    if (id) out.linearClientId = id;
  }
  if (typeof source.linearClientSecret === 'string') {
    const secret = source.linearClientSecret.trim();
    if (secret) out.linearClientSecret = secret;
  }
  if (typeof source.linearViewerName === 'string') {
    const name = source.linearViewerName.trim().slice(0, 120);
    if (name) out.linearViewerName = name;
  }
  if (typeof source.linearOrganizationName === 'string') {
    const name = source.linearOrganizationName.trim().slice(0, 120);
    if (name) out.linearOrganizationName = name;
  }
  if (
    typeof source.issueSource === 'string' &&
    ISSUE_SOURCES.has(source.issueSource as IssueSource)
  ) {
    out.issueSource = source.issueSource as IssueSource;
  }
  if (typeof source.slackClientId === 'string') {
    const id = source.slackClientId.trim();
    if (id) out.slackClientId = id;
  }
  if (typeof source.slackClientSecret === 'string') {
    const secret = source.slackClientSecret.trim();
    if (secret) out.slackClientSecret = secret;
  }
  if (typeof source.slackAppToken === 'string') {
    const token = source.slackAppToken.trim();
    if (token) out.slackAppToken = token;
  }
  if (typeof source.slackListenEnabled === 'boolean') {
    out.slackListenEnabled = source.slackListenEnabled;
  }
  if (typeof source.slackDeviceId === 'string') {
    const id = source.slackDeviceId.trim();
    if (id) out.slackDeviceId = id;
  }
  if (typeof source.slackDeviceLabel === 'string') {
    const label = source.slackDeviceLabel.trim().slice(0, 64);
    if (label) out.slackDeviceLabel = label;
  }
  if (
    typeof source.githubGitAuthMode === 'string' &&
    GIT_AUTH_MODES.has(source.githubGitAuthMode as GithubGitAuthMode)
  ) {
    out.githubGitAuthMode = source.githubGitAuthMode as GithubGitAuthMode;
  }
  if (typeof source.githubPat === 'string') {
    const pat = source.githubPat.trim();
    if (pat) out.githubPat = pat;
  }
  if (typeof source.abletimeAccessToken === 'string') {
    const token = source.abletimeAccessToken.trim();
    if (token) out.abletimeAccessToken = token;
  }
  if (typeof source.abletimeHost === 'string') {
    const host = source.abletimeHost.trim();
    if (host) out.abletimeHost = host;
  }
  if (typeof source.abletimeViewerName === 'string') {
    const name = source.abletimeViewerName.trim().slice(0, 120);
    if (name) out.abletimeViewerName = name;
  }
  if (typeof source.vercelToken === 'string') {
    const token = source.vercelToken.trim();
    if (token) out.vercelToken = token;
  }
  if (typeof source.vercelViewerName === 'string') {
    const name = source.vercelViewerName.trim().slice(0, 120);
    if (name) out.vercelViewerName = name;
  }
  if (typeof source.supabaseAccessToken === 'string') {
    const token = source.supabaseAccessToken.trim();
    if (token) out.supabaseAccessToken = token;
  }
  if (typeof source.supabaseViewerName === 'string') {
    const name = source.supabaseViewerName.trim().slice(0, 120);
    if (name) out.supabaseViewerName = name;
  }
  if (typeof source.posthogPersonalApiKey === 'string') {
    const key = source.posthogPersonalApiKey.trim();
    if (key) out.posthogPersonalApiKey = key;
  }
  if (typeof source.posthogHost === 'string') {
    const host = source.posthogHost.trim();
    if (host) out.posthogHost = host;
  }
  if (typeof source.posthogViewerName === 'string') {
    const name = source.posthogViewerName.trim().slice(0, 120);
    if (name) out.posthogViewerName = name;
  }
  if (typeof source.sentryAuthToken === 'string') {
    const token = source.sentryAuthToken.trim();
    if (token) out.sentryAuthToken = token;
  }
  if (typeof source.sentryHost === 'string') {
    const host = source.sentryHost.trim();
    if (host) out.sentryHost = host;
  }
  if (typeof source.sentryViewerName === 'string') {
    const name = source.sentryViewerName.trim().slice(0, 120);
    if (name) out.sentryViewerName = name;
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
  const notes = foldLegacyRolesIntoNotes(source.roles, source.role, source.notes);
  if (notes) out.notes = notes;
  return out;
}

function profileRepoKey(path: string): string {
  return path.trim().replace(/\/+$/, '');
}

function normalizeProjectProfile(raw: unknown): ProjectProfileSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const out: ProjectProfileSettings = {};
  const notes = foldLegacyRolesIntoNotes(source.roles, source.role, source.notes);
  if (notes) out.notes = notes;
  return out.notes ? out : undefined;
}

function normalizeProjects(raw: unknown): Record<string, ProjectProfileSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ProjectProfileSettings> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = profileRepoKey(path);
    if (!key) continue;
    const profile = normalizeProjectProfile(value);
    if (profile) out[key] = profile;
  }
  return out;
}

/** Match a repo or worktree path to a stored project profile key. */
export function findProjectProfileKey(
  projects: Record<string, ProjectProfileSettings>,
  repoPath?: string | null,
): string | undefined {
  const want = profileRepoKey(repoPath ?? '');
  if (!want) return undefined;
  if (projects[want]) return want;
  for (const key of Object.keys(projects)) {
    const stored = profileRepoKey(key);
    if (!stored) continue;
    if (stored === want || want.startsWith(`${stored}/`) || stored.startsWith(`${want}/`)) {
      return key;
    }
  }
  return undefined;
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
  if (typeof source.caffeinateWhileSlackListen === 'boolean') {
    out.caffeinateWhileSlackListen = source.caffeinateWhileSlackListen;
  } else if (typeof source.caffeinateWhileCloudConnect === 'boolean') {
    // Migrate former Brightsy cloud-connect toggle.
    out.caffeinateWhileSlackListen = source.caffeinateWhileCloudConnect;
  }
  if (typeof source.caffeinateWhileSchedules === 'boolean') {
    out.caffeinateWhileSchedules = source.caffeinateWhileSchedules;
  }
  if (typeof source.deleteBranchOnPurge === 'boolean') {
    out.deleteBranchOnPurge = source.deleteBranchOnPurge;
  }
  if (typeof source.cowboyMode === 'boolean') {
    out.cowboyMode = source.cowboyMode;
  }
  if (typeof source.showCost === 'boolean') {
    out.showCost = source.showCost;
  }
  if (typeof source.autoArchiveOnMerge === 'boolean') {
    out.autoArchiveOnMerge = source.autoArchiveOnMerge;
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
  if (
    source.orchestrationQuotaOnLimit === 'switch_agent' ||
    source.orchestrationQuotaOnLimit === 'wait_reset'
  ) {
    out.orchestrationQuotaOnLimit = source.orchestrationQuotaOnLimit;
  }
  if (
    typeof source.orchestrationQuotaFallbackAgent === 'string' &&
    DEFAULT_AGENTS.has(source.orchestrationQuotaFallbackAgent as AgentKind) &&
    source.orchestrationQuotaFallbackAgent !== 'brightsy'
  ) {
    out.orchestrationQuotaFallbackAgent =
      source.orchestrationQuotaFallbackAgent as AgentKind;
  }
  if (source.followUpBehavior === 'queue' || source.followUpBehavior === 'steer') {
    out.followUpBehavior = source.followUpBehavior;
  }
  return out;
}

function normalizeSettings(raw: unknown): AppSettings {
  const env: Record<string, string> = {};
  let claude: ClaudeHarnessSettings = {};
  let codex: CliExecutableSettings = {};
  let opencode: CliExecutableSettings = {};
  let brightsy: BrightsyHarnessSettings = {};
  let integrations: IntegrationsSettings = {};
  let defaults: DefaultsAppSettings = {};
  let projects: Record<string, ProjectProfileSettings> = {};
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
    if ('codex' in raw) {
      codex = normalizeCliExecutable((raw as { codex?: unknown }).codex);
    }
    if ('opencode' in raw) {
      opencode = normalizeCliExecutable((raw as { opencode?: unknown }).opencode);
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
    if ('projects' in raw) {
      projects = normalizeProjects((raw as { projects?: unknown }).projects);
    }
    if ('advanced' in raw) {
      advanced = normalizeAdvanced((raw as { advanced?: unknown }).advanced);
    }
  }
  return {
    environment: env,
    claude,
    codex,
    opencode,
    brightsy,
    integrations,
    defaults,
    projects,
    advanced,
  };
}

const EMPTY_SETTINGS: AppSettings = {
  environment: {},
  claude: {},
  codex: {},
  opencode: {},
  brightsy: {},
  integrations: {},
  defaults: {},
  projects: {},
  advanced: {},
};

function readSettingsFile(): AppSettings {
  const path = appSettingsPath();
  if (!existsSync(path)) return { ...EMPTY_SETTINGS };
  try {
    chmodOwnerOnly(path);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return normalizeSettings(parsed);
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

function diskHoldsSecrets(disk: AppSettings): boolean {
  return Boolean(
    disk.integrations.linearApiKey ||
      disk.integrations.linearAccessToken ||
      disk.integrations.linearRefreshToken ||
      disk.integrations.linearClientSecret ||
      disk.integrations.slackClientSecret ||
      disk.integrations.slackAppToken ||
      disk.integrations.githubPat ||
      disk.integrations.abletimeAccessToken ||
      disk.integrations.vercelToken ||
      disk.integrations.supabaseAccessToken ||
      disk.integrations.posthogPersonalApiKey ||
      disk.integrations.sentryAuthToken ||
      Object.keys(disk.environment).length > 0,
  );
}

function mergeVault(disk: AppSettings): AppSettings {
  const vault = loadSecretVault();
  const environment = { ...(vault.environment ?? {}), ...disk.environment };
  const integrations = { ...disk.integrations };
  if (vault.linearApiKey && !integrations.linearApiKey) {
    integrations.linearApiKey = vault.linearApiKey;
  }
  if (vault.linearAccessToken && !integrations.linearAccessToken) {
    integrations.linearAccessToken = vault.linearAccessToken;
  }
  if (vault.linearRefreshToken && !integrations.linearRefreshToken) {
    integrations.linearRefreshToken = vault.linearRefreshToken;
  }
  if (vault.linearClientSecret && !integrations.linearClientSecret) {
    integrations.linearClientSecret = vault.linearClientSecret;
  }
  if (vault.slackClientSecret && !integrations.slackClientSecret) {
    integrations.slackClientSecret = vault.slackClientSecret;
  }
  if (vault.slackAppToken && !integrations.slackAppToken) {
    integrations.slackAppToken = vault.slackAppToken;
  }
  if (vault.githubPat && !integrations.githubPat) {
    integrations.githubPat = vault.githubPat;
  }
  if (vault.abletimeAccessToken && !integrations.abletimeAccessToken) {
    integrations.abletimeAccessToken = vault.abletimeAccessToken;
  }
  if (vault.vercelToken && !integrations.vercelToken) {
    integrations.vercelToken = vault.vercelToken;
  }
  if (vault.supabaseAccessToken && !integrations.supabaseAccessToken) {
    integrations.supabaseAccessToken = vault.supabaseAccessToken;
  }
  if (vault.posthogPersonalApiKey && !integrations.posthogPersonalApiKey) {
    integrations.posthogPersonalApiKey = vault.posthogPersonalApiKey;
  }
  if (vault.sentryAuthToken && !integrations.sentryAuthToken) {
    integrations.sentryAuthToken = vault.sentryAuthToken;
  }
  return { ...disk, environment, integrations };
}

function persistSplit(settings: AppSettings): void {
  const integrations: IntegrationsSettings = { ...settings.integrations };
  const linearApiKey = integrations.linearApiKey;
  const linearAccessToken = integrations.linearAccessToken;
  const linearRefreshToken = integrations.linearRefreshToken;
  const linearClientSecret = integrations.linearClientSecret;
  const slackClientSecret = integrations.slackClientSecret;
  const slackAppToken = integrations.slackAppToken;
  const githubPat = integrations.githubPat;
  const abletimeAccessToken = integrations.abletimeAccessToken;
  const vercelToken = integrations.vercelToken;
  const supabaseAccessToken = integrations.supabaseAccessToken;
  const posthogPersonalApiKey = integrations.posthogPersonalApiKey;
  const sentryAuthToken = integrations.sentryAuthToken;
  delete integrations.linearApiKey;
  delete integrations.linearAccessToken;
  delete integrations.linearRefreshToken;
  delete integrations.linearClientSecret;
  delete integrations.slackClientSecret;
  delete integrations.slackAppToken;
  delete integrations.githubPat;
  delete integrations.abletimeAccessToken;
  delete integrations.vercelToken;
  delete integrations.supabaseAccessToken;
  delete integrations.posthogPersonalApiKey;
  delete integrations.sentryAuthToken;
  writePrivateFile(
    appSettingsPath(),
    `${JSON.stringify({ ...settings, environment: {}, integrations }, null, 2)}\n`,
  );
  saveSecretVault({
    linearApiKey,
    linearAccessToken,
    linearRefreshToken,
    linearClientSecret,
    slackClientSecret,
    slackAppToken,
    githubPat,
    abletimeAccessToken,
    vercelToken,
    supabaseAccessToken,
    posthogPersonalApiKey,
    sentryAuthToken,
    environment: settings.environment,
  });
}

export function loadAppSettings(): AppSettings {
  const disk = readSettingsFile();
  const merged = mergeVault(disk);
  if (diskHoldsSecrets(disk)) persistSplit(merged);
  return merged;
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  persistSplit(normalized);
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
    executablePath?: string | null;
    cloudConnectEnabled?: boolean;
    cloudConnectAgent?: BrightsyCloudConnectAgent | null;
    injectWorktreeMcp?: boolean;
  },
): AppSettings {
  const current = loadAppSettings();
  const brightsy: BrightsyHarnessSettings = { ...current.brightsy };
  if ('executablePath' in patch) {
    if (patch.executablePath == null || patch.executablePath.trim() === '') {
      delete brightsy.executablePath;
    } else {
      brightsy.executablePath = patch.executablePath.trim();
    }
  }
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
  if (typeof patch.injectWorktreeMcp === 'boolean') {
    brightsy.injectWorktreeMcp = patch.injectWorktreeMcp;
  }
  return saveAppSettings({ ...current, brightsy });
}

export function updateCodexSettings(
  patch: { executablePath?: string | null },
): AppSettings {
  const current = loadAppSettings();
  const codex: CliExecutableSettings = { ...current.codex };
  if ('executablePath' in patch) {
    if (patch.executablePath == null || patch.executablePath.trim() === '') {
      delete codex.executablePath;
    } else {
      codex.executablePath = patch.executablePath.trim();
    }
  }
  return saveAppSettings({ ...current, codex });
}

export function updateOpencodeSettings(
  patch: { executablePath?: string | null },
): AppSettings {
  const current = loadAppSettings();
  const opencode: CliExecutableSettings = { ...current.opencode };
  if ('executablePath' in patch) {
    if (patch.executablePath == null || patch.executablePath.trim() === '') {
      delete opencode.executablePath;
    } else {
      opencode.executablePath = patch.executablePath.trim();
    }
  }
  return saveAppSettings({ ...current, opencode });
}

export function updateIntegrationsSettings(
  patch: {
    linearApiKey?: string | null;
    linearClientId?: string | null;
    linearClientSecret?: string | null;
    issueSource?: IssueSource | null;
    slackClientId?: string | null;
    slackClientSecret?: string | null;
    slackAppToken?: string | null;
    slackListenEnabled?: boolean | null;
    slackDeviceId?: string | null;
    slackDeviceLabel?: string | null;
    githubGitAuthMode?: GithubGitAuthMode | null;
    githubPat?: string | null;
    abletimeAccessToken?: string | null;
    abletimeHost?: string | null;
    abletimeViewerName?: string | null;
    vercelToken?: string | null;
    vercelViewerName?: string | null;
    supabaseAccessToken?: string | null;
    supabaseViewerName?: string | null;
    posthogPersonalApiKey?: string | null;
    posthogHost?: string | null;
    posthogViewerName?: string | null;
    sentryAuthToken?: string | null;
    sentryHost?: string | null;
    sentryViewerName?: string | null;
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
  if ('linearClientId' in patch) {
    if (patch.linearClientId == null || patch.linearClientId.trim() === '') {
      delete integrations.linearClientId;
    } else {
      integrations.linearClientId = patch.linearClientId.trim();
    }
  }
  if ('linearClientSecret' in patch) {
    if (patch.linearClientSecret == null || patch.linearClientSecret.trim() === '') {
      delete integrations.linearClientSecret;
    } else {
      integrations.linearClientSecret = patch.linearClientSecret.trim();
    }
  }
  if ('issueSource' in patch) {
    if (patch.issueSource == null) {
      delete integrations.issueSource;
    } else if (ISSUE_SOURCES.has(patch.issueSource)) {
      integrations.issueSource = patch.issueSource;
    }
  }
  if ('slackClientId' in patch) {
    if (patch.slackClientId == null || patch.slackClientId.trim() === '') {
      delete integrations.slackClientId;
    } else {
      integrations.slackClientId = patch.slackClientId.trim();
    }
  }
  if ('slackClientSecret' in patch) {
    if (patch.slackClientSecret == null || patch.slackClientSecret.trim() === '') {
      delete integrations.slackClientSecret;
    } else {
      integrations.slackClientSecret = patch.slackClientSecret.trim();
    }
  }
  if ('slackAppToken' in patch) {
    if (patch.slackAppToken == null || patch.slackAppToken.trim() === '') {
      delete integrations.slackAppToken;
    } else {
      integrations.slackAppToken = patch.slackAppToken.trim();
    }
  }
  if ('slackListenEnabled' in patch) {
    if (patch.slackListenEnabled == null) {
      delete integrations.slackListenEnabled;
    } else {
      integrations.slackListenEnabled = Boolean(patch.slackListenEnabled);
    }
  }
  if ('slackDeviceId' in patch) {
    if (patch.slackDeviceId == null || patch.slackDeviceId.trim() === '') {
      delete integrations.slackDeviceId;
    } else {
      integrations.slackDeviceId = patch.slackDeviceId.trim();
    }
  }
  if ('slackDeviceLabel' in patch) {
    if (patch.slackDeviceLabel == null || patch.slackDeviceLabel.trim() === '') {
      delete integrations.slackDeviceLabel;
    } else {
      integrations.slackDeviceLabel = patch.slackDeviceLabel.trim().slice(0, 64);
    }
  }
  if ('githubGitAuthMode' in patch) {
    if (patch.githubGitAuthMode == null) {
      delete integrations.githubGitAuthMode;
    } else if (GIT_AUTH_MODES.has(patch.githubGitAuthMode)) {
      integrations.githubGitAuthMode = patch.githubGitAuthMode;
    }
  }
  if ('githubPat' in patch) {
    if (patch.githubPat == null || patch.githubPat.trim() === '') {
      delete integrations.githubPat;
    } else {
      integrations.githubPat = patch.githubPat.trim();
    }
  }
  if ('abletimeAccessToken' in patch) {
    if (patch.abletimeAccessToken == null || patch.abletimeAccessToken.trim() === '') {
      delete integrations.abletimeAccessToken;
      delete integrations.abletimeViewerName;
    } else {
      integrations.abletimeAccessToken = patch.abletimeAccessToken.trim();
    }
  }
  if ('abletimeHost' in patch) {
    if (patch.abletimeHost == null || patch.abletimeHost.trim() === '') {
      delete integrations.abletimeHost;
    } else {
      integrations.abletimeHost = patch.abletimeHost.trim();
    }
  }
  if ('abletimeViewerName' in patch) {
    if (patch.abletimeViewerName == null || patch.abletimeViewerName.trim() === '') {
      delete integrations.abletimeViewerName;
    } else {
      integrations.abletimeViewerName = patch.abletimeViewerName.trim().slice(0, 120);
    }
  }
  if ('vercelToken' in patch) {
    if (patch.vercelToken == null || patch.vercelToken.trim() === '') {
      delete integrations.vercelToken;
      delete integrations.vercelViewerName;
    } else {
      integrations.vercelToken = patch.vercelToken.trim();
    }
  }
  if ('vercelViewerName' in patch) {
    if (patch.vercelViewerName == null || patch.vercelViewerName.trim() === '') {
      delete integrations.vercelViewerName;
    } else {
      integrations.vercelViewerName = patch.vercelViewerName.trim().slice(0, 120);
    }
  }
  if ('supabaseAccessToken' in patch) {
    if (patch.supabaseAccessToken == null || patch.supabaseAccessToken.trim() === '') {
      delete integrations.supabaseAccessToken;
      delete integrations.supabaseViewerName;
    } else {
      integrations.supabaseAccessToken = patch.supabaseAccessToken.trim();
    }
  }
  if ('supabaseViewerName' in patch) {
    if (patch.supabaseViewerName == null || patch.supabaseViewerName.trim() === '') {
      delete integrations.supabaseViewerName;
    } else {
      integrations.supabaseViewerName = patch.supabaseViewerName.trim().slice(0, 120);
    }
  }
  if ('posthogPersonalApiKey' in patch) {
    if (patch.posthogPersonalApiKey == null || patch.posthogPersonalApiKey.trim() === '') {
      delete integrations.posthogPersonalApiKey;
      delete integrations.posthogViewerName;
    } else {
      integrations.posthogPersonalApiKey = patch.posthogPersonalApiKey.trim();
    }
  }
  if ('posthogHost' in patch) {
    if (patch.posthogHost == null || patch.posthogHost.trim() === '') {
      delete integrations.posthogHost;
    } else {
      integrations.posthogHost = patch.posthogHost.trim();
    }
  }
  if ('posthogViewerName' in patch) {
    if (patch.posthogViewerName == null || patch.posthogViewerName.trim() === '') {
      delete integrations.posthogViewerName;
    } else {
      integrations.posthogViewerName = patch.posthogViewerName.trim().slice(0, 120);
    }
  }
  if ('sentryAuthToken' in patch) {
    if (patch.sentryAuthToken == null || patch.sentryAuthToken.trim() === '') {
      delete integrations.sentryAuthToken;
      delete integrations.sentryViewerName;
    } else {
      integrations.sentryAuthToken = patch.sentryAuthToken.trim();
    }
  }
  if ('sentryHost' in patch) {
    if (patch.sentryHost == null || patch.sentryHost.trim() === '') {
      delete integrations.sentryHost;
    } else {
      integrations.sentryHost = patch.sentryHost.trim();
    }
  }
  if ('sentryViewerName' in patch) {
    if (patch.sentryViewerName == null || patch.sentryViewerName.trim() === '') {
      delete integrations.sentryViewerName;
    } else {
      integrations.sentryViewerName = patch.sentryViewerName.trim().slice(0, 120);
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
    notes?: string | null;
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
  if ('notes' in patch) {
    const notes = normalizeProfileNotes(patch.notes);
    if (!notes) delete defaults.notes;
    else defaults.notes = notes;
  }
  delete defaults.roles;
  delete defaults.role;
  return saveAppSettings({ ...current, defaults });
}

export function updateProjectProfileSettings(
  repoPath: string,
  patch: { notes?: string | null },
): AppSettings {
  const current = loadAppSettings();
  const key = profileRepoKey(repoPath);
  if (!key) return current;
  const projects = { ...current.projects };
  const existing = projects[key] ?? {};
  const next: ProjectProfileSettings = { ...existing };
  if ('notes' in patch) {
    const notes = normalizeProfileNotes(patch.notes);
    if (!notes) delete next.notes;
    else next.notes = notes;
  }
  delete next.roles;
  delete next.role;
  if (!next.notes) delete projects[key];
  else projects[key] = next;
  return saveAppSettings({ ...current, projects });
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
export {
  PROFILE_NOTES_MAX,
  foldLegacyRolesIntoNotes,
  formatAccountProfilePlaybookLine,
  formatProjectProfilePlaybookLines,
  formatViewerContextDirective,
  formatViewerContextReminder,
  formatWorkspaceProfileSuffix,
  resolveAccountProfile,
  resolveViewerProfile,
  type AccountProfile,
  type ResolvedAccountProfile,
  type ResolvedViewerProfile,
  type ViewerProfile,
} from './account-profile.js';

export function resolveAccountProfileFromSettings(
  settings: AppSettings = loadAppSettings(),
) {
  return resolveViewerProfile(settings.defaults);
}

export function resolveViewerProfileForRepo(
  repoPath?: string | null,
  settings: AppSettings = loadAppSettings(),
) {
  const key = findProjectProfileKey(settings.projects, repoPath);
  const project = key ? settings.projects[key] : undefined;
  return resolveViewerProfile(settings.defaults, project);
}

export function readViewerContext(repoPath?: string | null) {
  const settings = loadAppSettings();
  const key = findProjectProfileKey(settings.projects, repoPath);
  const resolved = resolveViewerProfile(
    settings.defaults,
    key ? settings.projects[key] : undefined,
  );
  return {
    account: resolved.accountNotes,
    project: resolved.projectNotes,
    combined: resolved.notes,
    repoPath: key ?? (repoPath?.trim() ? profileRepoKey(repoPath) : null),
  };
}

export type ViewerContextWriteResult =
  | {
      ok: true;
      scope: 'account' | 'project';
      context: string;
      repoPath?: string | null;
    }
  | {
      ok: false;
      error: string;
      message: string;
      current: string;
      proposed: string;
    };

const CONFIRM_ACCOUNT =
  'Show the user the proposed account context, call ask_user (Save this context / Do not save), wait for their answer, then retry with confirmed=true.';
const CONFIRM_PROJECT =
  'Show the user the proposed project context, call ask_user (Save this context / Do not save), wait for their answer, then retry with confirmed=true.';

export function writeViewerContext(input: {
  scope: 'account' | 'project';
  context: string;
  repoPath?: string | null;
  confirmed: boolean;
}): ViewerContextWriteResult {
  const proposed = normalizeProfileNotes(input.context);
  if (input.scope === 'project') {
    const settings = loadAppSettings();
    const key =
      findProjectProfileKey(settings.projects, input.repoPath) ??
      profileRepoKey(input.repoPath ?? '');
    if (!key) {
      return {
        ok: false,
        error: 'repoPath required',
        message: 'Pass repoPath (or run from a registered worktree) when updating project context.',
        current: '',
        proposed,
      };
    }
    const current = resolveViewerProfileForRepo(key, settings).projectNotes;
    if (!input.confirmed) {
      return {
        ok: false,
        error: 'Confirmation required',
        message: CONFIRM_PROJECT,
        current,
        proposed,
      };
    }
    updateProjectProfileSettings(key, { notes: proposed || null });
    return { ok: true, scope: 'project', context: proposed, repoPath: key };
  }
  const current = resolveAccountProfileFromSettings().accountNotes;
  if (!input.confirmed) {
    return {
      ok: false,
      error: 'Confirmation required',
      message: CONFIRM_ACCOUNT,
      current,
      proposed,
    };
  }
  updateDefaultsSettings({ notes: proposed || null });
  return { ok: true, scope: 'account', context: proposed };
}

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

/**
 * Resolve agent/model/effort/fast for a newly created thread.
 * Omitted fields use Agents defaults (Settings → Agents).
 * Pass `model: null` explicitly to force Auto / agent-default.
 */
export function resolveNewThreadOptions(
  overrides: {
    agent?: AgentKind | null;
    model?: string | null;
    effort?: ThinkingEffort | 'normal' | null;
    fast?: boolean | null;
  } = {},
  settings: AppSettings = loadAppSettings(),
): { agent: AgentKind; model: string | null; effort: ThinkingEffort; fast: boolean } {
  const defaults = resolveThreadDefaults(settings);
  const effort =
    overrides.effort === undefined || overrides.effort === null
      ? defaults.effort
      : (normalizeThinkingEffort(overrides.effort) ?? defaults.effort);
  const agent = overrides.agent ?? defaults.agent;
  let model =
    overrides.model === undefined
      ? defaults.model
      : overrides.model?.trim() || null;
  // Account "default"/"auto" is Cursor Auto — not a Codex/Claude/OpenCode model id.
  // Applying it to other agents makes later turns pass a bogus `--model default`.
  if (
    model &&
    agent !== 'cursor' &&
    /^(default|auto)$/i.test(model.trim())
  ) {
    model = null;
  }
  return {
    agent,
    model,
    effort,
    fast:
      overrides.fast === undefined || overrides.fast === null
        ? defaults.fast
        : Boolean(overrides.fast),
  };
}

/** True when Sideboard has Linear OAuth tokens or an API key stored. */
export function isLinearConnected(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return hasLinearCredentials(settings.integrations);
}

/** Persist Linear OAuth tokens after authorize or refresh. */
export function saveLinearOAuth(input: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  viewerName?: string;
  organizationName?: string;
}): AppSettings {
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  integrations.linearAccessToken = input.accessToken.trim();
  if (input.refreshToken?.trim()) {
    integrations.linearRefreshToken = input.refreshToken.trim();
  }
  if (typeof input.expiresIn === 'number' && Number.isFinite(input.expiresIn)) {
    integrations.linearTokenExpiresAt = Date.now() + Math.max(0, input.expiresIn) * 1000;
  }
  if (input.viewerName?.trim()) {
    integrations.linearViewerName = input.viewerName.trim().slice(0, 120);
  }
  if (input.organizationName?.trim()) {
    integrations.linearOrganizationName = input.organizationName.trim().slice(0, 120);
  }
  return saveAppSettings({ ...current, integrations });
}

/** Clear Linear OAuth tokens and API key. Does not revoke remotely. */
export function disconnectLinearConnection(): AppSettings {
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  delete integrations.linearApiKey;
  delete integrations.linearAccessToken;
  delete integrations.linearRefreshToken;
  delete integrations.linearTokenExpiresAt;
  delete integrations.linearViewerName;
  delete integrations.linearOrganizationName;
  return saveAppSettings({ ...current, integrations });
}

/** True when Sideboard has an AbleTime personal access token stored. */
export function isAbleTimeConnected(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.integrations.abletimeAccessToken?.trim());
}

export function getAbleTimeAccessToken(
  settings: AppSettings = loadAppSettings(),
): string | null {
  const token = settings.integrations.abletimeAccessToken?.trim();
  return token || null;
}

export function getAbleTimeHost(
  settings: AppSettings = loadAppSettings(),
): string {
  return settings.integrations.abletimeHost?.trim() || 'https://track.abletime.com';
}

/** Persist AbleTime PAT after a successful MCP orientation. */
export function saveAbleTimeConnection(input: {
  accessToken: string;
  host?: string | null;
  viewerName?: string | null;
}): AppSettings {
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  integrations.abletimeAccessToken = input.accessToken.trim();
  if (input.host?.trim()) {
    integrations.abletimeHost = input.host.trim();
  }
  if (input.viewerName?.trim()) {
    integrations.abletimeViewerName = input.viewerName.trim().slice(0, 120);
  }
  return saveAppSettings({ ...current, integrations });
}

/** Clear AbleTime PAT and viewer. Does not revoke remotely. */
export function disconnectAbleTimeConnection(): AppSettings {
  const current = loadAppSettings();
  const integrations: IntegrationsSettings = { ...current.integrations };
  delete integrations.abletimeAccessToken;
  delete integrations.abletimeViewerName;
  return saveAppSettings({ ...current, integrations });
}

/** Preferred issue source (default GitHub). */
export function getIssueSource(
  settings: AppSettings = loadAppSettings(),
): IssueSource {
  return settings.integrations.issueSource ?? 'github';
}

/** Declared GitHub git-auth mode (default `auto`). */
export function getGithubGitAuthMode(
  settings: AppSettings = loadAppSettings(),
): GithubGitAuthMode {
  return settings.integrations.githubGitAuthMode ?? 'auto';
}

/** Stored GitHub PAT for `token` mode (null when unset). */
export function getGithubPat(
  settings: AppSettings = loadAppSettings(),
): string | null {
  const pat = settings.integrations.githubPat?.trim();
  return pat || null;
}

/**
 * Whether this preferred source can list issues today.
 */
export function isIssueSourceConnected(
  source: IssueSource,
  settings: AppSettings = loadAppSettings(),
): boolean {
  if (source === 'github') return true;
  if (source === 'linear') return isLinearConnected(settings);
  if (source === 'abletime') return isAbleTimeConnected(settings);
  return false;
}

/**
 * Runtime issue source: honors preference, but falls back to GitHub when
 * the preferred tracker is not connected.
 */
export function resolveEffectiveIssueSource(
  settings: AppSettings = loadAppSettings(),
): IssueSource {
  const preferred = getIssueSource(settings);
  if (isIssueSourceConnected(preferred, settings)) return preferred;
  return 'github';
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

/** Slack Socket Mode inbound (Settings → Remote → Slack). Default off. */
export function slackListenEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return settings.integrations.slackListenEnabled === true;
}

/**
 * Stable per-Mac identity for the Slack relay so Personal and Work can both
 * stay online as separate destinations.
 */
export function ensureSlackDeviceIdentity(
  settings: AppSettings = loadAppSettings(),
): { deviceId: string; deviceLabel: string } {
  let deviceId = settings.integrations.slackDeviceId?.trim() ?? '';
  let deviceLabel = settings.integrations.slackDeviceLabel?.trim() ?? '';
  const patch: { slackDeviceId?: string; slackDeviceLabel?: string } = {};
  if (!deviceId) {
    deviceId = randomUUID();
    patch.slackDeviceId = deviceId;
  }
  if (!deviceLabel) {
    try {
      deviceLabel = hostname().split('.')[0]?.trim() || 'This Mac';
    } catch {
      deviceLabel = 'This Mac';
    }
    patch.slackDeviceLabel = deviceLabel;
  }
  if (Object.keys(patch).length > 0) {
    updateIntegrationsSettings(patch);
  }
  return { deviceId, deviceLabel };
}

/**
 * App-level token for Slack Socket Mode (`xapp-…`).
 * Env `SIDEBOARD_SLACK_APP_TOKEN` wins over settings.
 */
export function slackAppLevelToken(
  settings: AppSettings = loadAppSettings(),
): string {
  return (
    process.env.SIDEBOARD_SLACK_APP_TOKEN?.trim() ||
    settings.integrations.slackAppToken?.trim() ||
    ''
  );
}

/** Default off — worktree agents only get Brightsy MCP on ask / prior use. */
export function brightsyInjectWorktreeMcpEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.brightsy.injectWorktreeMcp);
}

/**
 * Local agent for the Brightsy cloud coordinator.
 * Prefer Account → Default agent when it can run orchestration (Claude / Cursor /
 * Codex / OpenCode). `cloudConnectAgent` is only a fallback when the account
 * default cannot orchestrate (e.g. Brightsy).
 */
export function brightsyCloudConnectAgent(
  settings: AppSettings = loadAppSettings(),
): BrightsyCloudConnectAgent {
  const fallback =
    settings.brightsy.cloudConnectAgent &&
    CLOUD_CONNECT_AGENTS.has(settings.brightsy.cloudConnectAgent)
      ? settings.brightsy.cloudConnectAgent
      : ('claude' as BrightsyCloudConnectAgent);
  const preferred = getDefaultAgent(settings);
  if (CLOUD_CONNECT_AGENTS.has(preferred as BrightsyCloudConnectAgent)) {
    return preferred as BrightsyCloudConnectAgent;
  }
  return fallback;
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
  if (typeof patch.caffeinateWhileSlackListen === 'boolean') {
    advanced.caffeinateWhileSlackListen = patch.caffeinateWhileSlackListen;
    delete advanced.caffeinateWhileCloudConnect;
  } else if (typeof patch.caffeinateWhileCloudConnect === 'boolean') {
    advanced.caffeinateWhileSlackListen = patch.caffeinateWhileCloudConnect;
    delete advanced.caffeinateWhileCloudConnect;
  }
  if (typeof patch.caffeinateWhileSchedules === 'boolean') {
    advanced.caffeinateWhileSchedules = patch.caffeinateWhileSchedules;
  }
  if (typeof patch.deleteBranchOnPurge === 'boolean') {
    advanced.deleteBranchOnPurge = patch.deleteBranchOnPurge;
  }
  if (typeof patch.cowboyMode === 'boolean') {
    advanced.cowboyMode = patch.cowboyMode;
  }
  if (typeof patch.showCost === 'boolean') {
    advanced.showCost = patch.showCost;
  }
  if (typeof patch.autoArchiveOnMerge === 'boolean') {
    advanced.autoArchiveOnMerge = patch.autoArchiveOnMerge;
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
  if (
    patch.orchestrationQuotaOnLimit === 'switch_agent' ||
    patch.orchestrationQuotaOnLimit === 'wait_reset'
  ) {
    advanced.orchestrationQuotaOnLimit = patch.orchestrationQuotaOnLimit;
  }
  if (
    typeof patch.orchestrationQuotaFallbackAgent === 'string' &&
    DEFAULT_AGENTS.has(patch.orchestrationQuotaFallbackAgent) &&
    patch.orchestrationQuotaFallbackAgent !== 'brightsy'
  ) {
    advanced.orchestrationQuotaFallbackAgent = patch.orchestrationQuotaFallbackAgent;
  }
  if (patch.followUpBehavior === 'queue' || patch.followUpBehavior === 'steer') {
    advanced.followUpBehavior = patch.followUpBehavior;
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

export function caffeinateWhileSlackListenEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.caffeinateWhileSlackListen);
}

export function caffeinateWhileSchedulesEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.caffeinateWhileSchedules);
}

/** @deprecated Use caffeinateWhileSlackListenEnabled. */
export function caffeinateWhileCloudConnectEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return caffeinateWhileSlackListenEnabled(settings);
}

export function deleteBranchOnPurgeEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.deleteBranchOnPurge);
}

/** Default off. When on, create may use the project checkout on the default branch. */
export function cowboyModeEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.cowboyMode);
}

/** Settings → Advanced → Show cost (when available) (default off). */
export function showCostEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.showCost);
}

/** Conductor-style opt-in — default off. */
export function autoArchiveOnMergeEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.autoArchiveOnMerge);
}

export function autoCleanupOrphansEnabled(
  settings: AppSettings = loadAppSettings(),
): boolean {
  return Boolean(settings.advanced.autoCleanupOrphans);
}

/** Default: switch to another agent (Auto) when orchestration hits a session limit. */
export function orchestrationQuotaOnLimit(
  settings: AppSettings = loadAppSettings(),
): OrchestrationQuotaOnLimit {
  return settings.advanced.orchestrationQuotaOnLimit ?? 'switch_agent';
}

/** Default fallback agent for orchestration session-limit continue (cursor). */
export function orchestrationQuotaFallbackAgent(
  settings: AppSettings = loadAppSettings(),
): AgentKind {
  const preferred = settings.advanced.orchestrationQuotaFallbackAgent;
  if (preferred && DEFAULT_AGENTS.has(preferred) && preferred !== 'brightsy') {
    return preferred;
  }
  return 'cursor';
}

/** Conductor default: steer — skip the queue and start the follow-up now. */
export function followUpBehavior(
  settings: AppSettings = loadAppSettings(),
): FollowUpBehavior {
  return settings.advanced.followUpBehavior === 'queue' ? 'queue' : 'steer';
}

export function maxConcurrentAgents(
  settings: AppSettings = loadAppSettings(),
): number {
  const n = settings.advanced.maxConcurrent;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return Math.max(1, Math.min(32, Math.floor(n)));
  }
  return 5;
}

/** Binary name or absolute path used to spawn Claude Code. */
export function resolveClaudeExecutable(
  settings: AppSettings = loadAppSettings(),
): string {
  return resolveAgentExecutable('claude', settings);
}

/** CLI agents that support a custom executable path override. */
export type CliAgentKind = 'claude' | 'codex' | 'opencode' | 'brightsy';

const DEFAULT_CLI_BIN: Record<CliAgentKind, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  brightsy: 'brightsy',
};

/** Binary name or absolute path for a CLI agent (custom path when set). */
export function resolveAgentExecutable(
  agent: CliAgentKind,
  settings: AppSettings = loadAppSettings(),
): string {
  const fallback = DEFAULT_CLI_BIN[agent];
  if (agent === 'claude') {
    const override = settings.claude.executablePath?.trim();
    return override || fallback;
  }
  if (agent === 'codex') {
    const override = settings.codex.executablePath?.trim();
    return override || fallback;
  }
  if (agent === 'opencode') {
    const override = settings.opencode.executablePath?.trim();
    return override || fallback;
  }
  const override = settings.brightsy.executablePath?.trim();
  return override || fallback;
}

export function updateAgentExecutable(
  agent: CliAgentKind,
  executablePath: string | null,
): AppSettings {
  if (agent === 'claude') {
    return updateClaudeSettings({ executablePath });
  }
  if (agent === 'codex') {
    return updateCodexSettings({ executablePath });
  }
  if (agent === 'opencode') {
    return updateOpencodeSettings({ executablePath });
  }
  return updateBrightsySettings({ executablePath });
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
  applyOptionalServiceTokens(target, settings.integrations);
  return target;
}

function fillEnvGap(
  target: NodeJS.ProcessEnv,
  key: string,
  value: string | undefined,
): void {
  const v = value?.trim();
  if (!key || !v) return;
  if (target[key] == null || target[key] === '') target[key] = v;
}

/** Connected optional-service tokens fill agent env gaps (shell / Environment win). */
function applyOptionalServiceTokens(
  target: NodeJS.ProcessEnv,
  integrations: IntegrationsSettings,
): void {
  fillEnvGap(target, 'VERCEL_TOKEN', integrations.vercelToken);
  fillEnvGap(target, 'SUPABASE_ACCESS_TOKEN', integrations.supabaseAccessToken);
  fillEnvGap(target, 'POSTHOG_PERSONAL_API_KEY', integrations.posthogPersonalApiKey);
  fillEnvGap(
    target,
    'POSTHOG_HOST',
    integrations.posthogPersonalApiKey
      ? integrations.posthogHost || 'https://us.posthog.com'
      : undefined,
  );
  fillEnvGap(target, 'SENTRY_AUTH_TOKEN', integrations.sentryAuthToken);
  fillEnvGap(
    target,
    'SENTRY_URL',
    integrations.sentryAuthToken
      ? integrations.sentryHost || 'https://sentry.io'
      : undefined,
  );
}

/** Env for a child process: host env + Sideboard settings (settings fill gaps). */
export function childEnvWithAppSettings(
  extra?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const settings = loadAppSettings();
  // Strip host Electron/Chromium keys so Claude Code / Cursor / nested
  // electron-vite do not attach to Sideboard.app's GPU/crashpad.
  // Intentional extras (e.g. ELECTRON_RUN_AS_NODE for asar scripts) re-apply after.
  const env = stripNestedElectronEnv({ ...process.env });
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
