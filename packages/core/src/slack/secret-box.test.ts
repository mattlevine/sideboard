import { describe, expect, it } from 'vitest';
import { openSecret, parseSlackTokenKey, sealSecret } from './secret-box.js';

describe('slack secret box', () => {
  const key = parseSlackTokenKey(Buffer.alloc(32, 7).toString('base64'));

  it('round-trips a bot token and rejects a different key', () => {
    const sealed = sealSecret(key, 'xoxb-bot');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('xoxb-bot');
    expect(openSecret(key, sealed)).toBe('xoxb-bot');
    const other = parseSlackTokenKey('11'.repeat(32));
    expect(() => openSecret(other, sealed)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => parseSlackTokenKey('aaaa')).toThrow(/32 bytes/);
  });
});
