import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHttpFetchImpl } from '../http/fetch.js';
import { startRemoteAccountLogin } from './account-login.js';

const ORIGIN = 'https://relay.sideboard.cloud';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('startRemoteAccountLogin', () => {
  afterEach(() => {
    setHttpFetchImpl(null);
  });

  it('reports the socket error, URL, and a work-network hint', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND relay.sideboard.cloud'), {
      code: 'ENOTFOUND',
    });
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));
    await expect(
      startRemoteAccountLogin({
        provider: 'github',
        origin: ORIGIN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      /fetch failed \[ENOTFOUND: getaddrinfo ENOTFOUND relay\.sideboard\.cloud\] \(https:\/\/relay\.sideboard\.cloud\/remote\/login\).*allowlist that does not include Sideboard/,
    );
  });

  it('explains a corporate CA rejection without the Linear hint', async () => {
    const cause = Object.assign(new Error('unable to get local issuer certificate'), {
      code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    });
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));
    const failed = startRemoteAccountLogin({
      provider: 'github',
      origin: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(failed).rejects.toThrow(/TLS certificate was rejected/);
    await expect(failed).rejects.toThrow(/allowlist/);
    await expect(failed).rejects.not.toThrow(/Desktop Linear/);
  });

  it('says when a proxy returns an HTML block page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>Blocked by proxy</html>', {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(
      startRemoteAccountLogin({
        provider: 'github',
        origin: ORIGIN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 403 with an HTML page.*block page/);
  });

  it('uses the desktop HTTP client when no fetch is passed', async () => {
    const injected = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, url: 'https://github.com/login/oauth/authorize' }),
    );
    setHttpFetchImpl(injected as unknown as typeof fetch);
    const ac = new AbortController();
    const pending = startRemoteAccountLogin({
      provider: 'github',
      origin: ORIGIN,
      signal: ac.signal,
      pollIntervalMs: 10_000,
    });
    await vi.waitFor(() => expect(injected).toHaveBeenCalled());
    ac.abort();
    await expect(pending).rejects.toThrow(/Sign-in cancelled/);
    expect(injected).toHaveBeenCalledWith(
      `${ORIGIN}/remote/login`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
