import type { AgentId, ComposerOptions, CreateMode, Effort } from './chat-ui';

/** Settings → Agents, as the desktop sends them on the sidebar. */
export type PhoneAgentDefaults = {
  agent: string;
  model: string | null;
  effort: string;
  fast: boolean;
};

export type PhoneAccountDefaults = {
  orchestration: PhoneAgentDefaults;
  worktree: PhoneAgentDefaults;
};

const AGENTS = new Set<AgentId>(['claude', 'codex', 'opencode', 'cursor', 'brightsy']);
const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max']);

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
    autonomy: 'default',
  };
}
