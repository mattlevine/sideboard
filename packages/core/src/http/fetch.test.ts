import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFetchError, httpFetch, setHttpFetchImpl } from './fetch.js';

describe('formatFetchError', () => {
  it('includes URL and undici cause code', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.linear.app'), {
      code: 'ENOTFOUND',
    });
    const err = Object.assign(new TypeError('fetch failed'), { cause });
    expect(formatFetchError(err, 'https://api.linear.app/oauth/token')).toBe(
      'fetch failed [ENOTFOUND: getaddrinfo ENOTFOUND api.linear.app] (https://api.linear.app/oauth/token)',
    );
  });
});

describe('httpFetch', () => {
  afterEach(() => {
    setHttpFetchImpl(null);
    vi.unstubAllGlobals();
  });

  it('uses injected fetch when set', async () => {
    const injected = vi.fn().mockResolvedValue({ ok: true });
    setHttpFetchImpl(injected as unknown as typeof fetch);
    await httpFetch('https://api.linear.app/graphql', { method: 'POST' });
    expect(injected).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rewrites TypeError fetch failed with the cause', async () => {
    const cause = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause })),
    );
    await expect(httpFetch('https://api.linear.app/oauth/token')).rejects.toThrow(
      'fetch failed [ETIMEDOUT: connect ETIMEDOUT] (https://api.linear.app/oauth/token)',
    );
  });
});
