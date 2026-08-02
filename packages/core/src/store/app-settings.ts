import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

export interface AppSettings {
  /** Environment variables injected into agent / hook processes (and process.env). */
  environment: Record<string, string>;
  /** Claude Code–specific harness settings. */
  claude: ClaudeHarnessSettings;
  /** Brightsy cloud connect preferences (Slack / Discord / Teams). */
  brightsy: BrightsyHarnessSettings;
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

function normalizeSettings(raw: unknown): AppSettings {
  const env: Record<string, string> = {};
  let claude: ClaudeHarnessSettings = {};
  let brightsy: BrightsyHarnessSettings = {};
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
  }
  return { environment: env, claude, brightsy };
}

export function loadAppSettings(): AppSettings {
  const path = appSettingsPath();
  if (!existsSync(path)) return { environment: {}, claude: {}, brightsy: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return normalizeSettings(parsed);
  } catch {
    return { environment: {}, claude: {}, brightsy: {} };
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
