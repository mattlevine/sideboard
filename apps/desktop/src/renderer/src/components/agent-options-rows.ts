import type { AcpHarnessId, AgentKind, Autonomy, ThinkingEffort } from '@sideboard-ai/core';

export interface AgentOptionsValue {
  agent: AgentKind;
  /** Gemini CLI or Copilot CLI when agent is acp. Null for every other agent. */
  acpHarness?: AcpHarnessId | null;
  model: string | null;
  autonomy: Autonomy;
  effort: ThinkingEffort;
  fast: boolean;
}

export type AgentOptionRow = {
  key: string;
  id: AgentKind;
  acpHarness?: AcpHarnessId;
  label: string;
};

export const AGENT_OPTION_ROWS: AgentOptionRow[] = [
  { key: 'claude', id: 'claude', label: 'Claude' },
  { key: 'codex', id: 'codex', label: 'Codex' },
  { key: 'opencode', id: 'opencode', label: 'OpenCode' },
  { key: 'cursor', id: 'cursor', label: 'Cursor' },
  { key: 'brightsy', id: 'brightsy', label: 'Brightsy' },
  { key: 'gemini', id: 'acp', acpHarness: 'gemini', label: 'Gemini CLI' },
  { key: 'copilot', id: 'acp', acpHarness: 'copilot', label: 'Copilot CLI' },
];

export function pickerAcpHarness(
  agent: AgentKind,
  harness: AcpHarnessId | null | undefined,
): AcpHarnessId | null {
  if (agent !== 'acp') return null;
  return harness === 'copilot' ? 'copilot' : 'gemini';
}

export function agentRowSelected(
  agent: AgentKind,
  harness: AcpHarnessId | null,
  row: AgentOptionRow,
): boolean {
  return agent === row.id && (row.id !== 'acp' || harness === (row.acpHarness ?? 'gemini'));
}

export function stampAgentOptions(
  agent: AgentKind,
  model: string | null,
  autonomy: Autonomy,
  effort: ThinkingEffort,
  fast: boolean,
  harness: AcpHarnessId | null,
): AgentOptionsValue {
  return {
    agent,
    model,
    autonomy,
    effort,
    fast,
    acpHarness: agent === 'acp' ? (harness ?? 'gemini') : null,
  };
}
