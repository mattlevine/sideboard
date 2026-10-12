import { describe, expect, it } from 'vitest';
import {
  linkifyThreadUrls,
  markdownUrlTransform,
  parseThreadLink,
  threadLinkUrl,
} from './thread-link';

describe('thread-link', () => {
  it('builds sideboard://chat urls', () => {
    expect(threadLinkUrl('abc-123')).toBe('sideboard://chat/abc-123');
  });

  it('parses full and short thread ids', () => {
    expect(parseThreadLink('sideboard://chat/abc-123')).toBe('abc-123');
    expect(parseThreadLink('sideboard://thread/abc-123')).toBe('abc-123');
    expect(parseThreadLink('sideboard://chat/deadbeef')).toBe('deadbeef');
    expect(parseThreadLink('sideboard://chat/deadbeef/')).toBe('deadbeef');
  });

  it('rejects non-thread urls', () => {
    expect(parseThreadLink('https://example.com')).toBeNull();
    expect(parseThreadLink('sideboard://workspace/foo')).toBeNull();
    expect(parseThreadLink('')).toBeNull();
  });

  it('keeps sideboard thread urls in markdownUrlTransform', () => {
    expect(markdownUrlTransform('sideboard://chat/abc-123')).toBe(
      'sideboard://chat/abc-123',
    );
    expect(markdownUrlTransform('sideboard://artifact/dashboard')).toBe(
      'sideboard://artifact/dashboard',
    );
    expect(markdownUrlTransform('sideboard://file/apps/a.ts#L12-L40')).toBe(
      'sideboard://file/apps/a.ts#L12-L40',
    );
    expect(markdownUrlTransform('https://example.com')).toBe('https://example.com');
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('');
  });

  it('linkifies bare sideboard thread urls', () => {
    expect(linkifyThreadUrls('see sideboard://chat/abcdef12-3456')).toBe(
      'see [abcdef12](sideboard://chat/abcdef12-3456)',
    );
    expect(linkifyThreadUrls('[Arsenal](sideboard://chat/abc-123)')).toBe(
      '[Arsenal](sideboard://chat/abc-123)',
    );
    expect(linkifyThreadUrls('open sideboard://file/apps/desktop/src/App.tsx#L12-L40')).toBe(
      'open [App.tsx:12-40](sideboard://file/apps/desktop/src/App.tsx#L12-L40)',
    );
    expect(linkifyThreadUrls('see sideboard://artifact/Dashboard')).toBe(
      'see [Dashboard](sideboard://artifact/Dashboard)',
    );
  });
});
