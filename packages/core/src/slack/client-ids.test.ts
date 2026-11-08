import { describe, expect, it } from 'vitest';
import { mergeSlackClientIds } from './client-ids.js';

describe('mergeSlackClientIds', () => {
  it('keeps every distinct client id', () => {
    expect(mergeSlackClientIds([' A ', 'B', 'A', '', null, 'B', 'C'])).toEqual(['A', 'B', 'C']);
  });
});
