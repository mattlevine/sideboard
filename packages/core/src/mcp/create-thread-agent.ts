import type { AgentKind } from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';

export type ResolveNewThreadOptions = (overrides: {
  agent?: AgentKind;
  model?: string | null;
}) => {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
};

export type OrchCreateThreadResolution = {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  /** Requested agent that was dropped (parent echo or Cursor autofill). */
  ignoredAgent?: AgentKind;
  /** Codex child under a Codex orchestrator — coerced to a non-Codex agent. */
  coercedFrom?: AgentKind;
};

/**
 * Agent/model for MCP `create_thread` / `start_board_card`.
 *
 * Settings → Default agent wins unless the caller passed a real override.
 * Orchestrators (especially Cursor) echo their own agent or the last enum
 * value (`cursor`); those are not overrides. Nested Codex is coerced only
 * when the parent orchestrator is also Codex.
 */
export function resolveOrchCreateThreadOptions(input: {
  requestedAgent?: AgentKind;
  requestedModel?: string | null;
  parentAgent?: AgentKind | null;
  resolveNewThreadOptions: ResolveNewThreadOptions;
}): OrchCreateThreadResolution {
  const { resolveNewThreadOptions } = input;
  const account = resolveNewThreadOptions({});
  const requested = input.requestedAgent;
  const parent = input.parentAgent ?? undefined;

  let agent = account.agent;
  let ignoredAgent: AgentKind | undefined;
  let honorRequestedModel = false;

  if (requested) {
    const parentEcho =
      Boolean(parent) && requested === parent && requested !== account.agent;
    const cursorAutofill = requested === 'cursor' && account.agent !== 'cursor';
    if (parentEcho || cursorAutofill) {
      ignoredAgent = requested;
    } else {
      agent = requested;
      honorRequestedModel = input.requestedModel !== undefined;
    }
  }

  let coercedFrom: AgentKind | undefined;
  // Parent echo already drops a Codex-orchestrator `agent=codex` when Account
  // default is something else. The only remaining nested-Codex case is both
  // parent and Account default being Codex.
  if (agent === 'codex' && parent === 'codex') {
    coercedFrom = requested ?? 'codex';
    agent = 'cursor';
  }

  const opts = resolveNewThreadOptions({
    agent,
    model: honorRequestedModel ? input.requestedModel : undefined,
  });
  return {
    ...opts,
    ...(ignoredAgent ? { ignoredAgent } : {}),
    ...(coercedFrom ? { coercedFrom } : {}),
  };
}

export function orchCreateThreadAgentNote(input: {
  agent: AgentKind;
  ignoredAgent?: AgentKind;
  coercedFrom?: AgentKind;
}): string | undefined {
  if (input.coercedFrom) {
    return `Avoid nested Codex under a Codex orchestrator — used Account default agent=${input.agent}`;
  }
  if (input.ignoredAgent) {
    return `Ignored agent=${input.ignoredAgent} — used Account default agent=${input.agent}`;
  }
  return undefined;
}
