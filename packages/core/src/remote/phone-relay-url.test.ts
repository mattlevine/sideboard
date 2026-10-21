import { describe, expect, it } from 'vitest';
import { relaySocketUrl } from '../../../../apps/mobile/relay-address.ts';
import { createRelayLink, RELAY_ADDRESS_INVALID } from '../../../../apps/mobile/relay-link.ts';

const HOSTED = 'wss://relay.sideboard.cloud/remote';

describe('relaySocketUrl', () => {
  it('uses the hosted address only when the field is blank', () => {
    expect(relaySocketUrl('', HOSTED)).toBe(HOSTED);
    expect(relaySocketUrl('   ', HOSTED)).toBe(HOSTED);
    expect(relaySocketUrl('wss://mac.example/remote', HOSTED)).toBe('wss://mac.example/remote');
  });

  it('does not fall back when the typed address is not a relay', () => {
    expect(relaySocketUrl('https://mac.example/health', HOSTED)).toBe('');
    expect(relaySocketUrl('https://mac.example/docs', HOSTED)).toBe('');
  });
});

describe('createRelayLink', () => {
  it('does not open a socket for a blank relay address', () => {
    const opened: string[] = [];
    const Original = globalThis.WebSocket;
    class FakeSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 3;
      readyState = 0;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(url: string) {
        opened.push(url);
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const errors: string[] = [];
    try {
      const link = createRelayLink({
        url: () => '',
        onMessage: () => undefined,
        onError: (message) => errors.push(message),
        onClose: () => undefined,
        attached: () => false,
        inChat: () => false,
        sessionToken: () => null,
      });
      link.send({ type: 'pair', code: 'x' });
      expect(opened).toEqual([]);
      expect(errors).toEqual([RELAY_ADDRESS_INVALID]);
    } finally {
      globalThis.WebSocket = Original;
    }
  });
});
