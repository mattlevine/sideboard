import { afterEach, describe, expect, it } from 'vitest';
import { BAKED_REMOTE_RELAY_URL, normalizeRemoteRelayUrl, remoteRelayUrl } from './protocol.js';

describe('normalizeRemoteRelayUrl', () => {
  it('turns an https origin into the phone websocket', () => {
    expect(normalizeRemoteRelayUrl('https://relay.example.com')).toBe('wss://relay.example.com/remote');
    expect(normalizeRemoteRelayUrl('wss://relay.example.com/remote/')).toBe(
      'wss://relay.example.com/remote',
    );
  });

  it('keeps ws for a relay on this machine', () => {
    expect(normalizeRemoteRelayUrl('http://127.0.0.1:8080/remote')).toBe(
      'ws://127.0.0.1:8080/remote',
    );
  });

  it('rejects anything that is not the relay path', () => {
    expect(normalizeRemoteRelayUrl('https://example.com/docs')).toBeNull();
    expect(normalizeRemoteRelayUrl('ftp://example.com/remote')).toBeNull();
  });
});

describe('remoteRelayUrl', () => {
  const prev = process.env.SIDEBOARD_REMOTE_RELAY_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.SIDEBOARD_REMOTE_RELAY_URL;
    else process.env.SIDEBOARD_REMOTE_RELAY_URL = prev;
  });

  it('uses a saved address ahead of the env override', () => {
    process.env.SIDEBOARD_REMOTE_RELAY_URL = 'wss://from-env.example/remote';
    expect(remoteRelayUrl('https://mine.example')).toBe('wss://mine.example/remote');
  });

  it('uses the env override when Settings is empty', () => {
    process.env.SIDEBOARD_REMOTE_RELAY_URL = 'wss://from-env.example/remote';
    expect(remoteRelayUrl(null)).toBe('wss://from-env.example/remote');
    expect(remoteRelayUrl('')).toBe('wss://from-env.example/remote');
  });

  it('falls back to the hosted relay', () => {
    delete process.env.SIDEBOARD_REMOTE_RELAY_URL;
    expect(remoteRelayUrl()).toBe(BAKED_REMOTE_RELAY_URL);
  });
});
