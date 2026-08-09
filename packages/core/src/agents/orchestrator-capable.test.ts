import { describe, expect, it } from 'vitest';
import {
  assertOrchestratorCapableAgent,
  coerceOrchestratorAgent,
  isOrchestratorCapableAgent,
  ORCHESTRATOR_AGENT_KINDS,
} from './orchestrator-capable.js';

describe('orchestrator-capable', () => {
  it('allows Claude, Cursor, Codex, and OpenCode', () => {
    expect(ORCHESTRATOR_AGENT_KINDS).toEqual([
      'claude',
      'codex',
      'opencode',
      'cursor',
    ]);
    for (const agent of ORCHESTRATOR_AGENT_KINDS) {
      expect(isOrchestratorCapableAgent(agent)).toBe(true);
      expect(assertOrchestratorCapableAgent(agent)).toBe(agent);
    }
  });

  it('rejects Brightsy as an orchestrator', () => {
    expect(isOrchestratorCapableAgent('brightsy')).toBe(false);
    expect(() => assertOrchestratorCapableAgent('brightsy')).toThrow(
      /does not support Sideboard MCP/,
    );
  });

  it('coerces unsupported agents to Claude', () => {
    expect(coerceOrchestratorAgent('brightsy')).toBe('claude');
    expect(coerceOrchestratorAgent(null)).toBe('claude');
    expect(coerceOrchestratorAgent('cursor')).toBe('cursor');
  });
});
