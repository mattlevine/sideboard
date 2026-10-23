import {
  resolveOrchestratorDefaults,
  resolveThreadDefaults,
} from '../store/app-settings.js';
import type { AgentKind, Autonomy } from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';

/** Agent, model, effort, and autonomy for one new phone chat. */
export interface PhoneAgentDefaults {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  autonomy: Autonomy;
}

/** Settings → Agents: orchestration default and worktree default. */
export interface PhoneAccountDefaults {
  orchestration: PhoneAgentDefaults;
  worktree: PhoneAgentDefaults;
}

function row(resolved: PhoneAgentDefaults): PhoneAgentDefaults {
  return {
    agent: resolved.agent,
    model: resolved.model,
    effort: resolved.effort,
    fast: resolved.fast,
    autonomy: resolved.autonomy,
  };
}

export function phoneAccountDefaults(): PhoneAccountDefaults {
  return {
    orchestration: row(resolveOrchestratorDefaults()),
    worktree: row(resolveThreadDefaults()),
  };
}
