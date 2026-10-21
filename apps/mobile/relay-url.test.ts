import { describe, expect, it } from 'vitest';
import { normalizeRelayUrl } from './relay-url';

describe('normalizeRelayUrl', () => {
  it('adds the remote path and upgrades https', () => {
    expect(normalizeRelayUrl('https://relay.example.com')).toBe('wss://relay.example.com/remote');
    expect(normalizeRelayUrl('wss://relay.example.com/remote/')).toBe('wss://relay.example.com/remote');
  });

  it('keeps a local ws address', () => {
    expect(normalizeRelayUrl('ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/remote');
  });

  it('rejects a page that is not the relay', () => {
    expect(normalizeRelayUrl('https://relay.example.com/docs')).toBeNull();
    expect(normalizeRelayUrl('')).toBeNull();
  });
});
