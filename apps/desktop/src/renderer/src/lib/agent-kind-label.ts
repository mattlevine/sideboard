import type { AgentKind } from '@sideboard-ai/core';

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  brightsy: 'Brightsy',
};

export function agentKindLabel(agent: string): string {
  return AGENT_KIND_LABELS[agent as AgentKind] ?? agent;
}
