import type { AgentKind } from '../types/thread.js';

/**
 * Agents that Sideboard can inject Sideboard MCP into for fleet orchestration.
 * Brightsy CLI has no local MCP injection — it cannot be an orchestrator.
 */
export const ORCHESTRATOR_AGENT_KINDS = [
  'claude',
  'codex',
  'opencode',
  'cursor',
] as const satisfies readonly AgentKind[];

export type OrchestratorAgentKind = (typeof ORCHESTRATOR_AGENT_KINDS)[number];

export function isOrchestratorCapableAgent(
  agent: AgentKind | null | undefined,
): agent is OrchestratorAgentKind {
  return Boolean(
    agent && (ORCHESTRATOR_AGENT_KINDS as readonly string[]).includes(agent),
  );
}

export function assertOrchestratorCapableAgent(
  agent: AgentKind,
  context = 'orchestration',
): OrchestratorAgentKind {
  if (!isOrchestratorCapableAgent(agent)) {
    throw new Error(
      `${agent} cannot run ${context} — it does not support Sideboard MCP. Use Claude, Cursor, Codex, or OpenCode.`,
    );
  }
  return agent;
}

/** Prefer a capable agent; fall back to Claude when the choice is unsupported. */
export function coerceOrchestratorAgent(
  agent: AgentKind | null | undefined,
  fallback: OrchestratorAgentKind = 'claude',
): OrchestratorAgentKind {
  return isOrchestratorCapableAgent(agent) ? agent : fallback;
}
