import { describe, expect, it } from 'vitest';
import {
  linkifyThreadUrls,
  markdownUrlTransform,
  parseThreadLink,
  threadLinkUrl,
} from './thread-link';

describe('thread-link', () => {
  it('builds sideboard://thread urls', () => {
    expect(threadLinkUrl('abc-123')).toBe('sideboard://thread/abc-123');
  });

  it('parses full and short thread ids', () => {
    expect(parseThreadLink('sideboard://thread/abc-123')).toBe('abc-123');
    expect(parseThreadLink('sideboard://thread/deadbeef')).toBe('deadbeef');
    expect(parseThreadLink('sideboard://thread/deadbeef/')).toBe('deadbeef');
  });

  it('rejects non-thread urls', () => {
    expect(parseThreadLink('https://example.com')).toBeNull();
    expect(parseThreadLink('sideboard://workspace/foo')).toBeNull();
    expect(parseThreadLink('')).toBeNull();
  });

  it('keeps sideboard thread urls in markdownUrlTransform', () => {
    expect(markdownUrlTransform('sideboard://thread/abc-123')).toBe(
      'sideboard://thread/abc-123',
    );
    expect(markdownUrlTransform('https://example.com')).toBe('https://example.com');
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('');
  });

  it('linkifies bare sideboard thread urls', () => {
    expect(linkifyThreadUrls('see sideboard://thread/abcdef12-3456')).toBe(
      'see [abcdef12](sideboard://thread/abcdef12-3456)',
    );
    expect(linkifyThreadUrls('[Arsenal](sideboard://thread/abc-123)')).toBe(
      '[Arsenal](sideboard://thread/abc-123)',
    );
  });
});
