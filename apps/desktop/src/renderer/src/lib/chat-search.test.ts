import { describe, expect, it } from 'vitest';
import {
  chatMessageSearchText,
  chatSearchQuery,
  findChatSearchHits,
  nextChatSearchIndex,
} from './chat-search';

describe('chatMessageSearchText', () => {
  it('uses message text and extra text parts', () => {
    expect(
      chatMessageSearchText({
        text: 'Hello',
        parts: [
          { type: 'text', text: 'Hello' },
          { type: 'thinking', text: 'secret' },
          { type: 'text', text: 'More' },
        ],
      }),
    ).toBe('Hello\nMore');
  });

  it('skips continue notes', () => {
    expect(chatMessageSearchText({ text: 'Detached job still running', origin: 'continue' })).toBe(
      '',
    );
  });

  it('indexes tool labels when the message body is empty', () => {
    expect(
      chatMessageSearchText({
        text: '',
        parts: [{ type: 'tool', name: 'present_plan', description: 'Draft the rollout' }],
      }),
    ).toBe('Draft the rollout\npresent_plan');
  });
});

describe('findChatSearchHits', () => {
  it('returns empty for a blank query', () => {
    expect(findChatSearchHits('   ', [{ text: 'hello' }])).toEqual([]);
  });

  it('matches case-insensitively in transcript order', () => {
    expect(
      findChatSearchHits('Ship', [
        { text: 'please ship the menu' },
        { text: 'unrelated' },
        { text: 'SHIP it' },
      ]),
    ).toEqual(['msg-0', 'msg-2']);
  });

  it('includes pending and live extras after messages', () => {
    expect(
      findChatSearchHits(
        'foo',
        [{ text: 'foo one' }],
        { pending: 'foo pending', live: 'foo live' },
      ),
    ).toEqual(['msg-0', 'pending', 'live']);
  });

  it('does not match continue rows', () => {
    expect(
      findChatSearchHits('job', [{ text: 'Detached job still running', origin: 'continue' }]),
    ).toEqual([]);
  });
});

describe('chatSearchQuery', () => {
  it('trims and caps length', () => {
    expect(chatSearchQuery('  hi  ')).toBe('hi');
    expect(chatSearchQuery('x'.repeat(250)).length).toBe(200);
  });
});

describe('nextChatSearchIndex', () => {
  it('wraps around', () => {
    expect(nextChatSearchIndex(0, 3, 1)).toBe(1);
    expect(nextChatSearchIndex(2, 3, 1)).toBe(0);
    expect(nextChatSearchIndex(0, 3, -1)).toBe(2);
    expect(nextChatSearchIndex(0, 0, 1)).toBe(0);
  });
});
