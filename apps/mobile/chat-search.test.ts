import { describe, expect, it } from 'vitest';
import {
  chatSearchQuery,
  currentLocalIndex,
  findBubbleSearchHits,
  findQueryOffsets,
  highlightSegments,
  nextChatSearchIndex,
  seedChatSearchQuery,
} from './chat-search';
import { visibleFindParts } from './find-parts';

describe('chat search', () => {
  it('caps and trims the query', () => {
    expect(chatSearchQuery('  ship  ')).toBe('ship');
    expect(chatSearchQuery('x'.repeat(250))).toHaveLength(200);
  });

  it('seeds from the menu query, then the selection', () => {
    expect(seedChatSearchQuery('  seed  ', 'selected')).toBe('seed');
    expect(seedChatSearchQuery('', '  selected  ')).toBe('selected');
    expect(seedChatSearchQuery(undefined, 'picked')).toBe('picked');
    expect(seedChatSearchQuery('   ', '   ')).toBe('');
  });

  it('finds each non-overlapping occurrence, ignoring case', () => {
    expect(findQueryOffsets('Ship the ship', 'ship')).toEqual([0, 9]);
    expect(findQueryOffsets('foo', '   ')).toEqual([]);
  });

  it('splits highlight runs without dropping surrounding text', () => {
    expect(highlightSegments('a ship b ship', 'ship')).toEqual([
      { text: 'a ', match: false },
      { text: 'ship', match: true },
      { text: ' b ', match: false },
      { text: 'ship', match: true },
    ]);
  });

  it('walks every occurrence in transcript order', () => {
    const hits = findBubbleSearchHits('ship', [
      { id: 'a', text: 'ship it' },
      { id: 'b', text: 'nope' },
      { id: 'c', text: 'Ship then ship' },
    ]);
    expect(hits).toEqual([
      { id: 'a', local: 0 },
      { id: 'c', local: 0 },
      { id: 'c', local: 1 },
    ]);
    expect(currentLocalIndex(hits, 2, 'c')).toBe(1);
    expect(currentLocalIndex(hits, 0, 'c')).toBe(-1);
  });

  it('counts only the strings the renderer paints', () => {
    const hits = findBubbleSearchHits(
      'ship',
      [{ id: 'a', text: 'see [docs](https://example.com/ship) then ship' }],
      () => ['see ', 'docs', ' then ship'],
    );
    expect(hits).toEqual([{ id: 'a', local: 0 }]);
  });

  it('skips mermaid source and link urls, and keeps chip labels', () => {
    const parts = visibleFindParts([
      { type: 'text', content: 'See ', children: [] },
      { type: 'link', children: [{ type: 'text', content: 'docs', children: [] }] },
      { type: 'text', content: ' and ship', children: [] },
      { type: 'fence', sourceInfo: 'mermaid', content: 'ship\n', children: [] },
      { type: 'fence', sourceInfo: 'apps/mobile/App.tsx', content: 'ship\n', children: [] },
      { type: 'fence', sourceInfo: 'sb-artifact', content: 'Ship plan\nhidden ship', children: [] },
      { type: 'image', children: [{ type: 'text', content: 'ship', children: [] }] },
    ]);
    expect(parts).toEqual(['See ', 'docs', ' and ship', 'apps/mobile/app.tsx', 'Ship plan']);
    const hits = findBubbleSearchHits('ship', [{ id: 'a', text: 'ignored' }], () => parts);
    expect(hits.map((hit) => hit.local)).toEqual([0, 1]);
  });

  it('wraps next and previous', () => {
    expect(nextChatSearchIndex(0, 3, 1)).toBe(1);
    expect(nextChatSearchIndex(2, 3, 1)).toBe(0);
    expect(nextChatSearchIndex(0, 3, -1)).toBe(2);
    expect(nextChatSearchIndex(0, 0, 1)).toBe(0);
  });
});
