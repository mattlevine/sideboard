import { describe, expect, it } from 'vitest';
import { joinSteerPrompt, livePartsShowAgentReply, trailingUnansweredUserText } from './agent-has-replied.js';

describe('joinSteerPrompt', () => {
  it('appends the next line onto the unanswered prompt', () => {
    expect(joinSteerPrompt('Work on issue A', 'And B')).toBe('Work on issue A\nAnd B');
  });
});

describe('trailingUnansweredUserText', () => {
  it('returns the latest user prompt when the agent has not answered', () => {
    expect(
      trailingUnansweredUserText([
        { role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' },
      ]),
    ).toBe('Work on issue A');
  });

  it('returns null once an agent reply is stored', () => {
    expect(
      trailingUnansweredUserText([
        { role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' },
        { role: 'agent', text: 'On it', ts: '2026-01-01T00:00:01.000Z' },
      ]),
    ).toBeNull();
  });
});

describe('livePartsShowAgentReply', () => {
  it('is false before the agent has produced anything', () => {
    expect(livePartsShowAgentReply([])).toBe(false);
    expect(livePartsShowAgentReply([{ type: 'text', text: '   ' }])).toBe(false);
    expect(livePartsShowAgentReply([{ type: 'thinking', text: '' }])).toBe(false);
  });

  it('is true once text, thinking, or a tool is visible', () => {
    expect(livePartsShowAgentReply([{ type: 'text', text: 'On it' }])).toBe(true);
    expect(livePartsShowAgentReply([{ type: 'thinking', text: 'checking' }])).toBe(true);
    expect(
      livePartsShowAgentReply([
        { type: 'tool', id: '1', name: 'read', status: 'running' },
      ]),
    ).toBe(true);
  });
});
