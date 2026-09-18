import { describe, expect, it } from 'vitest';
import {
  chatMessageSearchText,
  chatSearchQuery,
  findChatSearchHits,
  findQueryOffsets,
  nextChatSearchIndex,
  seedChatSearchQuery,
  shouldDeferChatFind,
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

  it('does not index tool names or descriptions', () => {
    expect(
      chatMessageSearchText({
        text: '',
        parts: [{ type: 'tool', name: 'present_plan', description: 'Draft the rollout' }],
      }),
    ).toBe('');
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

  it('does not count tool-only messages as hits', () => {
    expect(
      findChatSearchHits('present_plan', [
        { text: '', parts: [{ type: 'tool', name: 'present_plan', description: 'Draft' }] },
      ]),
    ).toEqual([]);
  });

  it('counts every occurrence in a message', () => {
    expect(findChatSearchHits('foo', [{ text: 'foo then foo again' }])).toEqual(['msg-0', 'msg-0']);
  });
});

describe('findQueryOffsets', () => {
  it('finds non-overlapping case-insensitive matches', () => {
    expect(findQueryOffsets('Ship the SHIP', 'ship')).toEqual([0, 9]);
    expect(findQueryOffsets('aaaa', 'aa')).toEqual([0, 2]);
    expect(findQueryOffsets('hello', 'x')).toEqual([]);
  });
});

describe('chatSearchQuery', () => {
  it('trims and caps length', () => {
    expect(chatSearchQuery('  hi  ')).toBe('hi');
    expect(chatSearchQuery('x'.repeat(250)).length).toBe(200);
  });
});

describe('seedChatSearchQuery', () => {
  it('prefers a non-empty seed over the selection', () => {
    expect(seedChatSearchQuery('  seed  ', 'selected')).toBe('seed');
  });

  it('falls back to the selection when the seed is blank', () => {
    expect(seedChatSearchQuery('', '  selected  ')).toBe('selected');
    expect(seedChatSearchQuery(undefined, 'picked')).toBe('picked');
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

describe('shouldDeferChatFind', () => {
  it('does not defer a missing target', () => {
    expect(shouldDeferChatFind(null)).toBe(false);
  });
});
