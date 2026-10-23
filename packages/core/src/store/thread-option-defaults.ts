import { coerceOrchestratorAgent } from '../agents/orchestrator-capable.js';
import type { AgentKind, Autonomy } from '../types/thread.js';
import { normalizeThinkingEffort, type ThinkingEffort } from '../types/thinking-effort.js';
import { loadAppSettings, type AppSettings } from './app-settings.js';

export function normalizeAutonomy(value: unknown): Autonomy | undefined {
  return value === 'default' || value === 'full' ? value : undefined;
}

/** Default agent for Create / new chats (claude when unset). */
export function getDefaultAgent(settings: AppSettings = loadAppSettings()): AgentKind {
  return settings.defaults.agent ?? 'claude';
}

/** Default model id for Create / new chats (`null` = Auto / agent default). */
export function getDefaultModel(settings: AppSettings = loadAppSettings()): string | null {
  const model = settings.defaults.model?.trim();
  return model || null;
}

/** Default thinking effort for Create / new chats (`high` when unset). */
export function getDefaultEffort(settings: AppSettings = loadAppSettings()): ThinkingEffort {
  return normalizeThinkingEffort(settings.defaults.effort) ?? 'high';
}

/** Default fast-mode flag for Create / new chats (`true` = Fast). */
export function getDefaultFast(settings: AppSettings = loadAppSettings()): boolean {
  return settings.defaults.fast === true;
}

/** Default permission mode for new chats. Unset means full autonomy. */
export function getDefaultAutonomy(settings: AppSettings = loadAppSettings()): Autonomy {
  return settings.defaults.autonomy === 'default' ? 'default' : 'full';
}

export type ResolvedThreadDefaults = {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  autonomy: Autonomy;
};

export function resolveThreadDefaults(
  settings: AppSettings = loadAppSettings(),
): ResolvedThreadDefaults {
  return {
    agent: getDefaultAgent(settings),
    model: getDefaultModel(settings),
    effort: getDefaultEffort(settings),
    fast: getDefaultFast(settings),
    autonomy: getDefaultAutonomy(settings),
  };
}

/**
 * Defaults for new Global / Slack / cloud orchestrator chats.
 * Unset orchestrator settings inherit account defaults (agent coerced).
 * When `defaults.orchestrator` is present, omitted model means Auto.
 */
export function resolveOrchestratorDefaults(
  settings: AppSettings = loadAppSettings(),
): ResolvedThreadDefaults {
  const account = resolveThreadDefaults(settings);
  const orch = settings.defaults.orchestrator;
  const agent = coerceOrchestratorAgent(orch?.agent ?? account.agent);
  let model = orch ? orch.model?.trim() || null : account.model;
  if (model && agent !== 'cursor' && /^(default|auto)$/i.test(model.trim())) {
    model = null;
  }
  return {
    agent,
    model,
    effort: orch?.effort ?? account.effort,
    fast: orch?.fast ?? account.fast,
    autonomy: orch?.autonomy ?? account.autonomy,
  };
}

function mergeThreadOptionOverrides(
  defaults: ResolvedThreadDefaults,
  overrides: {
    agent?: AgentKind | null;
    model?: string | null;
    effort?: ThinkingEffort | 'normal' | null;
    fast?: boolean | null;
    autonomy?: Autonomy | null;
  },
): ResolvedThreadDefaults {
  const effort =
    overrides.effort === undefined || overrides.effort === null
      ? defaults.effort
      : (normalizeThinkingEffort(overrides.effort) ?? defaults.effort);
  const agent = overrides.agent ?? defaults.agent;
  let model =
    overrides.model === undefined ? defaults.model : overrides.model?.trim() || null;
  // Account "default"/"auto" is Cursor Auto — not a Codex/Claude/OpenCode model id.
  // Applying it to other agents makes later turns pass a bogus `--model default`.
  if (model && agent !== 'cursor' && /^(default|auto)$/i.test(model.trim())) {
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
    autonomy:
      overrides.autonomy == null
        ? defaults.autonomy
        : (normalizeAutonomy(overrides.autonomy) ?? defaults.autonomy),
  };
}

/**
 * Resolve agent/model/effort/fast/autonomy for a newly created thread.
 * Omitted fields use Agents defaults (Settings → Agents).
 * Pass `model: null` explicitly to force Auto / agent-default.
 * Omitted autonomy is full unless Settings stores Default permissions.
 */
export function resolveNewThreadOptions(
  overrides: {
    agent?: AgentKind | null;
    model?: string | null;
    effort?: ThinkingEffort | 'normal' | null;
    fast?: boolean | null;
    autonomy?: Autonomy | null;
  } = {},
  settings: AppSettings = loadAppSettings(),
): ResolvedThreadDefaults {
  return mergeThreadOptionOverrides(resolveThreadDefaults(settings), overrides);
}

/**
 * Resolve agent/model/effort/fast/autonomy for a new orchestrator chat.
 * Omitted fields use Settings → Default orchestrator (else account defaults).
 */
export function resolveNewOrchestratorOptions(
  overrides: {
    agent?: AgentKind | null;
    model?: string | null;
    effort?: ThinkingEffort | 'normal' | null;
    fast?: boolean | null;
    autonomy?: Autonomy | null;
  } = {},
  settings: AppSettings = loadAppSettings(),
): ResolvedThreadDefaults {
  return mergeThreadOptionOverrides(resolveOrchestratorDefaults(settings), overrides);
}
