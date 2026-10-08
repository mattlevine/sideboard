import { describe, expect, it } from 'vitest';
import { applyAgentEvent } from '../agents/message-parts.js';
import { phoneStreamFlushNow, phoneStreamFrame, phoneStreamParts, phoneStreamVerb } from './phone-stream.js';

describe('phoneStreamFrame', () => {
  it('keeps markdown text and switches the activity line when a tool starts', () => {
    let parts = phoneStreamParts([], { type: 'stdout', data: 'Hello **world**' }) ?? [];
    expect(phoneStreamFrame(parts)).toEqual({
      text: 'Hello **world**',
      activity: 'Writing reply…',
    });
    expect(phoneStreamVerb('Writing reply…', true)).toBe('');
    expect(phoneStreamVerb('Writing reply…', false)).toBe('Thinking');

    parts = applyAgentEvent(parts, {
      type: 'tool_use',
      id: 't1',
      name: 'Bash',
      input: { command: 'git status' },
    });
    const frame = phoneStreamFrame(parts);
    expect(frame.text).toBe('Hello **world**');
    expect(frame.activity.toLowerCase()).toMatch(/git status|bash/);
    expect(phoneStreamVerb(frame.activity, true)).toBe(frame.activity);
    expect(phoneStreamFlushNow({ type: 'tool_use', id: 't1', name: 'Bash' })).toBe(true);
    expect(phoneStreamFlushNow({ type: 'stdout', data: 'x' })).toBe(false);
  });

  it('ignores usage and session frames', () => {
    expect(phoneStreamParts([], { type: 'usage', data: { inputTokens: 1, outputTokens: 1 } })).toBeNull();
    expect(phoneStreamParts([], { type: 'session_id', data: 's' })).toBeNull();
  });
});
