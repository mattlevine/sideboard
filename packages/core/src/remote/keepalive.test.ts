import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteKeepalive, formatRemoteHostError } from './client.js';

describe('createRemoteKeepalive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings immediately and closes when pong never arrives', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const timeouts: string[] = [];
    const keepalive = createRemoteKeepalive({
      intervalMs: 20_000,
      pongTimeoutMs: 15_000,
      sendPing: () => sent.push('ping'),
      onTimeout: () => timeouts.push('timeout'),
    });
    expect(sent).toEqual(['ping']);
    vi.advanceTimersByTime(14_999);
    expect(timeouts).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(timeouts).toEqual(['timeout']);
    keepalive.stop();
  });

  it('stays open when pong arrives before the timeout', () => {
    vi.useFakeTimers();
    const timeouts: string[] = [];
    const keepalive = createRemoteKeepalive({
      intervalMs: 20_000,
      pongTimeoutMs: 15_000,
      sendPing: () => undefined,
      onTimeout: () => timeouts.push('timeout'),
    });
    keepalive.gotPong();
    vi.advanceTimersByTime(15_000);
    expect(timeouts).toEqual([]);
    keepalive.stop();
  });
});

describe('formatRemoteHostError', () => {
  it('explains a corporate CA rejection on the relay socket', () => {
    const formatted = formatRemoteHostError(
      Object.assign(new Error('unable to get local issuer certificate'), {
        code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      }),
    );
    expect(formatted).toContain('unable to get local issuer certificate');
    expect(formatted).toContain('corporate CA');
  });

  it('leaves unrelated socket errors unchanged', () => {
    expect(formatRemoteHostError(new Error('remote ping timeout'))).toBe('remote ping timeout');
  });
});
