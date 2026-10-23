import type { AgentId, ComposerOptions, CreateMode, CreateSelection, Effort } from './chat-ui';

/** Settings → Agents, as the desktop sends them on the sidebar. */
export type PhoneAgentDefaults = {
  agent: string;
  model: string | null;
  effort: string;
  fast: boolean;
  autonomy?: 'default' | 'full';
};

export type PhoneAccountDefaults = {
  orchestration: PhoneAgentDefaults;
  worktree: PhoneAgentDefaults;
};

const AGENTS = new Set<AgentId>(['claude', 'codex', 'opencode', 'cursor', 'brightsy']);
const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Blank create is allowed for a new chat in a worktree, and for a project ticket
 * (the issue is the prompt). Orchestration still needs a goal. Project PRs,
 * branches, and the default branch need text.
 */
export function createAllowEmpty(mode: CreateMode['kind'], selection: CreateSelection['kind']): boolean {
  if (mode === 'orchestration') return false;
  return mode !== 'project' || selection === 'ticket';
}

/** Composer chips for a new chat. Worktrees use the worktree default; orchestration uses its own. */
export function composerOptionsFor(
  kind: CreateMode['kind'],
  defaults: PhoneAccountDefaults | null,
): ComposerOptions {
  const row = defaults ? (kind === 'orchestration' ? defaults.orchestration : defaults.worktree) : null;
  const agent = row && AGENTS.has(row.agent as AgentId) ? (row.agent as AgentId) : 'claude';
  const effort = row && EFFORTS.has(row.effort as Effort) ? (row.effort as Effort) : 'medium';
  return {
    agent,
    model: row ? row.model : null,
    effort,
    fast: row?.fast === true,
    planMode: false,
    autonomy: row?.autonomy === 'default' ? 'default' : 'full',
  };
}
