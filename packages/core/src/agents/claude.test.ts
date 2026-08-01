import { describe, expect, it } from 'vitest';
import { claudeAdapter } from './claude.js';

describe('claudeAdapter.parseEvent', () => {
  it('extracts session_id from init', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' }),
    );
    expect(event).toEqual({ type: 'session_id', data: 'sess-123' });
  });

  it('extracts assistant text', () => {
    const event = claudeAdapter.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    expect(event).toEqual({ type: 'stdout', data: 'hello' });
  });
});
