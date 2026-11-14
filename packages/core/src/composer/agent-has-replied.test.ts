import { describe, expect, it } from 'vitest';
import {
  joinSteerPrompt,
  livePartsShowAgentReply,
  messagesWithRewrittenUserPrompt,
  trailingUnansweredUserText,
  userMessagesCoverPrompt,
} from './agent-has-replied.js';

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

describe('userMessagesCoverPrompt', () => {
  it('matches one stored message or the separate lines that were joined', () => {
    const separate = [
      { role: 'user' as const, text: 'Work on issue A', ts: '1' },
      { role: 'user' as const, text: 'And B', ts: '2' },
    ];
    expect(userMessagesCoverPrompt(separate, 'Work on issue A\nAnd B')).toBe(true);
    expect(userMessagesCoverPrompt(separate, 'Work on issue A')).toBe(true);
    expect(
      userMessagesCoverPrompt(
        [{ role: 'user', text: 'Work on issue A\nAnd B', ts: '1' }],
        'Work on issue A\nAnd B',
      ),
    ).toBe(true);
  });

  it('does not join across an agent reply or invent a missing line', () => {
    expect(
      userMessagesCoverPrompt(
        [
          { role: 'user', text: 'Work on issue A', ts: '1' },
          { role: 'agent', text: 'done', ts: '2' },
          { role: 'user', text: 'And B', ts: '3' },
        ],
        'Work on issue A\nAnd B',
      ),
    ).toBe(false);
    expect(
      userMessagesCoverPrompt(
        [
          { role: 'user', text: 'Work on issue A', ts: '1' },
          { role: 'agent', text: 'partial', ts: '2' },
        ],
        'Work on issue A\nAnd B',
      ),
    ).toBe(false);
  });
});

describe('messagesWithRewrittenUserPrompt', () => {
  it('updates the user prompt above a partial agent reply', () => {
    const messages = messagesWithRewrittenUserPrompt(
      [
        { role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' },
        { role: 'agent', text: 'partial', ts: '2026-01-01T00:00:01.000Z' },
      ],
      'Work on issue A',
      'Work on issue A\nAnd B',
    );
    expect(messages?.[0]?.text).toBe('Work on issue A\nAnd B');
    expect(messages?.[1]?.text).toBe('partial');
  });

  it('keeps a follow-up image on the rewritten user message', () => {
    const img = {
      id: 'img-1',
      name: 'shot.png',
      kind: 'file' as const,
      content: 'Image attached: shot.png',
      previewDataUrl: 'data:image/png;base64,xx',
    };
    const messages = messagesWithRewrittenUserPrompt(
      [{ role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' }],
      'Work on issue A',
      'Work on issue A\nAnd B',
      [img],
    );
    expect(messages?.[0]?.attachments).toEqual([img]);
  });

  it('does not rewrite an older user message when a later one does not match', () => {
    expect(
      messagesWithRewrittenUserPrompt(
        [
          { role: 'user', text: 'Work on issue A', ts: '2026-01-01T00:00:00.000Z' },
          { role: 'agent', text: 'done', ts: '2026-01-01T00:00:01.000Z' },
          { role: 'user', text: 'Something else', ts: '2026-01-01T00:00:02.000Z' },
        ],
        'Work on issue A',
        'Work on issue A\nAnd B',
      ),
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
