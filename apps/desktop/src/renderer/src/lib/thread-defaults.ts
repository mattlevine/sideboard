import type {
  AgentKind,
  PublicAppSettings,
  ThinkingEffort,
} from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { parseThinkingEffort } from '../components/ThinkingEffortChip';

export type ThreadDefaults = {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
};

function fallbackDefaults(): ThreadDefaults {
  return { agent: 'claude', model: null, effort: 'high' };
}

function coerceOrchestratorAgent(agent: AgentKind): AgentKind {
  return (ORCHESTRATOR_AGENT_KINDS as readonly string[]).includes(agent)
    ? agent
    : 'claude';
}

/** App defaults for Create / new chat tabs (Settings → Agents). */
export function threadDefaultsFromSettings(
  settings: Pick<PublicAppSettings, 'defaults'>,
): ThreadDefaults {
  return {
    agent: settings.defaults?.agent ?? 'claude',
    model: settings.defaults?.model?.trim() || null,
    effort: parseThinkingEffort(settings.defaults?.effort),
  };
}

/**
 * Defaults for Global / Slack / cloud orchestrator chats.
 * Unset orchestrator settings inherit account defaults (agent coerced).
 * When `defaults.orchestrator` is present, omitted model means Auto.
 */
export function orchestratorDefaultsFromSettings(
  settings: Pick<PublicAppSettings, 'defaults'>,
): ThreadDefaults {
  const account = threadDefaultsFromSettings(settings);
  const orch = settings.defaults?.orchestrator;
  const agent = coerceOrchestratorAgent(orch?.agent ?? account.agent);
  let model = orch ? orch.model?.trim() || null : account.model;
  if (model && agent !== 'cursor' && /^(default|auto)$/i.test(model.trim())) {
    model = null;
  }
  return {
    agent,
    model,
    effort: orch?.effort ? parseThinkingEffort(orch.effort) : account.effort,
  };
}

/** App defaults for Create / new chat tabs (Settings → Agents). */
export async function loadThreadDefaults(): Promise<ThreadDefaults> {
  try {
    return threadDefaultsFromSettings(await window.sideboard.getAppSettings());
  } catch {
    return fallbackDefaults();
  }
}

/** Settings → Default orchestrator (else account defaults). */
export async function loadOrchestratorDefaults(): Promise<ThreadDefaults> {
  try {
    return orchestratorDefaultsFromSettings(await window.sideboard.getAppSettings());
  } catch {
    return fallbackDefaults();
  }
}
