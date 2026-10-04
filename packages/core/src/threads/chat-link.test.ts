import { describe, expect, it } from 'vitest';
import {
  CHAT_LINK_PREFIX,
  chatLinkUrl,
  linkifyChatUrls,
  parseChatLink,
} from './chat-link.js';

describe('chat-link', () => {
  it('builds sideboard://chat urls', () => {
    expect(chatLinkUrl('abc-123')).toBe('sideboard://chat/abc-123');
    expect(CHAT_LINK_PREFIX).toBe('sideboard://chat/');
  });

  it('parses chat and legacy thread hrefs', () => {
    expect(parseChatLink('sideboard://chat/abc-123')).toBe('abc-123');
    expect(parseChatLink('sideboard://thread/abc-123')).toBe('abc-123');
    expect(parseChatLink('sideboard://chat/deadbeef/')).toBe('deadbeef');
    expect(parseChatLink('https://example.com')).toBeNull();
  });

  it('linkifies bare chat and thread urls to the canonical prefix', () => {
    expect(linkifyChatUrls('see sideboard://chat/abcdef12-3456')).toBe(
      'see [abcdef12](sideboard://chat/abcdef12-3456)',
    );
    expect(linkifyChatUrls('see sideboard://thread/abcdef12-3456')).toBe(
      'see [abcdef12](sideboard://chat/abcdef12-3456)',
    );
    expect(linkifyChatUrls('[Arsenal](sideboard://chat/abc-123)')).toBe(
      '[Arsenal](sideboard://chat/abc-123)',
    );
  });
});
