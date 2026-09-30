import { describe, expect, it, vi } from 'vitest';
import {
  applyAutocomplete,
  autocompleteItemsFromQuery,
  consumeAutocompleteKeyDown,
  getAutocompleteQuery,
} from './ComposerAutocomplete';

const skills = [
  {
    id: 'ws:review',
    name: 'review',
    command: 'review',
    description: 'Merge-readiness review',
    source: 'workspace',
  },
  {
    id: 'bundled:long-running',
    name: 'long-running',
    command: 'long-running',
    description: 'Detach long jobs',
    source: 'bundled',
  },
];

describe('getAutocompleteQuery', () => {
  it('opens the skill picker on a leading slash', () => {
    expect(getAutocompleteQuery('/', 1)).toEqual({
      kind: 'skill',
      query: '',
      start: 0,
      end: 1,
    });
  });

  it('filters skills after /review', () => {
    expect(getAutocompleteQuery('/rev', 4)).toEqual({
      kind: 'skill',
      query: 'rev',
      start: 0,
      end: 4,
    });
  });

  it('opens after whitespace, not mid-word', () => {
    expect(getAutocompleteQuery('please /', 8)?.kind).toBe('skill');
    expect(getAutocompleteQuery('http://', 7)).toBeNull();
  });
});

describe('autocompleteItemsFromQuery', () => {
  it('lists matching skills for a slash query', () => {
    const query = getAutocompleteQuery('/', 1);
    const items = autocompleteItemsFromQuery(query, { skills });
    expect(items.map((i) => i.label)).toEqual(['/review', '/long-running']);
    expect(items[0]?.insert).toBe('/review ');
  });

  it('filters by command fragment', () => {
    const query = getAutocompleteQuery('/long', 5);
    const items = autocompleteItemsFromQuery(query, { skills });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('/long-running');
  });

  it('hides the picker when suppressed', () => {
    const query = getAutocompleteQuery('/', 1);
    expect(autocompleteItemsFromQuery(query, { skills, suppressed: true })).toEqual([]);
  });
});

describe('consumeAutocompleteKeyDown', () => {
  it('picks on Enter instead of submitting', () => {
    const onPick = vi.fn();
    const e = { key: 'Enter', shiftKey: false, preventDefault: vi.fn() };
    const handled = consumeAutocompleteKeyDown(e, {
      items: [{ id: '1', label: '/review', insert: '/review ', kind: 'skill' }],
      activeIndex: 0,
      onIndex: vi.fn(),
      onPick,
      onSuppress: vi.fn(),
    });
    expect(handled).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalled();
  });
});

describe('applyAutocomplete', () => {
  it('replaces the slash token', () => {
    expect(applyAutocomplete('/', 0, 1, '/review ')).toEqual({
      value: '/review ',
      cursor: 8,
    });
  });
});
