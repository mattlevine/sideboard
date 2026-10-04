import { describe, expect, it } from 'vitest';
import { AGENT_KIND_LABELS, agentKindLabel } from './agent-kind-label';

describe('agentKindLabel', () => {
  it('uses the short product name, not the raw kind id', () => {
    expect(agentKindLabel('claude')).toBe('Claude');
    expect(agentKindLabel('codex')).toBe('Codex');
    expect(agentKindLabel('opencode')).toBe('OpenCode');
    expect(agentKindLabel('cursor')).toBe('Cursor');
    expect(agentKindLabel('brightsy')).toBe('Brightsy');
  });

  it('covers every known agent kind', () => {
    expect(Object.keys(AGENT_KIND_LABELS).sort()).toEqual(
      ['brightsy', 'claude', 'codex', 'cursor', 'opencode'].sort(),
    );
  });

  it('falls back to the raw id for unknown agents', () => {
    expect(agentKindLabel('mystery')).toBe('mystery');
  });
});
