import type { AgentKind } from '@sideboard-ai/core';

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  brightsy: 'Brightsy',
  acp: 'ACP',
};

export function agentKindLabel(agent: string, acpHarness?: string | null): string {
  if (agent === 'acp' && acpHarness === 'gemini') return 'Gemini CLI';
  if (agent === 'acp' && acpHarness === 'copilot') return 'Copilot CLI';
  return AGENT_KIND_LABELS[agent as AgentKind] ?? agent;
}
