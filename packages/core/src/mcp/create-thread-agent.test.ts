import { describe, expect, it } from 'vitest';
import type { AgentKind } from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';
import {
  orchCreateThreadAgentNote,
  resolveOrchCreateThreadOptions,
  type ResolveNewThreadOptions,
} from './create-thread-agent.js';

function resolver(
  account: {
    agent: AgentKind;
    model?: string | null;
    effort?: ThinkingEffort;
    fast?: boolean;
  },
): ResolveNewThreadOptions {
  const defaults = {
    agent: account.agent,
    model: account.model ?? null,
    effort: account.effort ?? 'high',
    fast: account.fast ?? false,
  };
  return (overrides) => ({
    agent: overrides.agent ?? defaults.agent,
    model:
      overrides.model !== undefined ? overrides.model : defaults.model,
    effort: defaults.effort,
    fast: defaults.fast,
  });
}

describe('resolveOrchCreateThreadOptions', () => {
  it('uses Account default when agent is omitted', () => {
    const resolved = resolveOrchCreateThreadOptions({
      parentAgent: 'cursor',
      resolveNewThreadOptions: resolver({ agent: 'codex', model: 'gpt-5' }),
    });
    expect(resolved.agent).toBe('codex');
    expect(resolved.model).toBe('gpt-5');
    expect(resolved.ignoredAgent).toBeUndefined();
    expect(resolved.coercedFrom).toBeUndefined();
  });

  it('ignores Cursor autofill when Account default is not Cursor', () => {
    const resolved = resolveOrchCreateThreadOptions({
      requestedAgent: 'cursor',
      requestedModel: 'default',
      parentAgent: 'claude',
      resolveNewThreadOptions: resolver({ agent: 'codex', model: 'gpt-5' }),
    });
    expect(resolved.agent).toBe('codex');
    expect(resolved.model).toBe('gpt-5');
    expect(resolved.ignoredAgent).toBe('cursor');
    expect(orchCreateThreadAgentNote(resolved)).toMatch(/Ignored agent=cursor/);
  });

  it('ignores an orchestrator echoing its own agent', () => {
    const resolved = resolveOrchCreateThreadOptions({
      requestedAgent: 'claude',
      parentAgent: 'claude',
      resolveNewThreadOptions: resolver({ agent: 'opencode' }),
    });
    expect(resolved.agent).toBe('opencode');
    expect(resolved.ignoredAgent).toBe('claude');
  });

  it('honors an explicit non-parent override', () => {
    const resolved = resolveOrchCreateThreadOptions({
      requestedAgent: 'opencode',
      requestedModel: 'glm-4',
      parentAgent: 'cursor',
      resolveNewThreadOptions: resolver({ agent: 'claude', model: 'sonnet' }),
    });
    expect(resolved.agent).toBe('opencode');
    expect(resolved.model).toBe('glm-4');
    expect(resolved.ignoredAgent).toBeUndefined();
  });

  it('does not coerce Codex children unless the parent orchestrator is Codex', () => {
    const resolved = resolveOrchCreateThreadOptions({
      parentAgent: 'cursor',
      resolveNewThreadOptions: resolver({ agent: 'codex' }),
    });
    expect(resolved.agent).toBe('codex');
    expect(resolved.coercedFrom).toBeUndefined();
  });

  it('drops a Codex orchestrator echoing agent=codex when Account default is not Codex', () => {
    const resolved = resolveOrchCreateThreadOptions({
      requestedAgent: 'codex',
      parentAgent: 'codex',
      resolveNewThreadOptions: resolver({ agent: 'claude' }),
    });
    expect(resolved.agent).toBe('claude');
    expect(resolved.ignoredAgent).toBe('codex');
    expect(resolved.coercedFrom).toBeUndefined();
    expect(orchCreateThreadAgentNote(resolved)).toMatch(/Ignored agent=codex/);
  });

  it('falls back to Cursor when parent and Account default are both Codex and a Cursor key is set', () => {
    const resolved = resolveOrchCreateThreadOptions({
      parentAgent: 'codex',
      cursorReady: true,
      resolveNewThreadOptions: resolver({ agent: 'codex' }),
    });
    expect(resolved.agent).toBe('cursor');
    expect(resolved.coercedFrom).toBe('codex');
    expect(orchCreateThreadAgentNote(resolved)).toMatch(/used agent=cursor/);
  });

  it('keeps Codex when parent and Account default are both Codex but Cursor is not configured', () => {
    const resolved = resolveOrchCreateThreadOptions({
      parentAgent: 'codex',
      cursorReady: false,
      resolveNewThreadOptions: resolver({ agent: 'codex' }),
    });
    expect(resolved.agent).toBe('codex');
    expect(resolved.coercedFrom).toBeUndefined();
    expect(orchCreateThreadAgentNote(resolved)).toBeUndefined();
  });

  it('keeps Cursor when it is the Account default', () => {
    const resolved = resolveOrchCreateThreadOptions({
      requestedAgent: 'cursor',
      parentAgent: 'cursor',
      resolveNewThreadOptions: resolver({ agent: 'cursor', model: 'default' }),
    });
    expect(resolved.agent).toBe('cursor');
    expect(resolved.model).toBe('default');
    expect(resolved.ignoredAgent).toBeUndefined();
  });
});
