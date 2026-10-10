import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('posthog_api', () => {
  const prevHome = process.env.HOME;
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevVault = process.env.SIDEBOARD_SECRET_VAULT;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    if (prevVault === undefined) delete process.env.SIDEBOARD_SECRET_VAULT;
    else process.env.SIDEBOARD_SECRET_VAULT = prevVault;
    vi.resetModules();
  });

  async function load() {
    const home = mkdtempSync(join(tmpdir(), 'sb-posthog-api-'));
    process.env.HOME = home;
    process.env.SIDEBOARD_APP_DATA = home;
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
    const [tools, settings, fetchMod] = await Promise.all([
      import('./posthog-tools.js'),
      import('../store/app-settings.js'),
      import('../http/fetch.js'),
    ]);
    return { ...tools, settings, setHttpFetchImpl: fetchMod.setHttpFetchImpl };
  }

  function payload(result: { content?: Array<{ text?: string }>; isError?: boolean }) {
    return {
      isError: result.isError === true,
      body: JSON.parse(result.content?.[0]?.text ?? '{}') as {
        ok?: boolean;
        error?: string;
        status?: number;
        body?: unknown;
      },
    };
  }

  it('rejects URLs and parent segments', async () => {
    const mod = await load();
    expect(() => mod.posthogApiUrl('https://us.posthog.com', 'https://evil.example/api/x')).toThrow(
      /\/api\//,
    );
    expect(() => mod.posthogApiUrl('https://us.posthog.com', '/api/../secrets')).toThrow(/not a URL/);
    expect(mod.posthogApiUrl('eu.posthog.com', '/api/projects/', { limit: '1' })).toBe(
      'https://eu.posthog.com/api/projects/?limit=1',
    );
  });

  it('refuses writes unless write=true, and GET with a body', async () => {
    const mod = await load();
    const fetchImpl = vi.fn();
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const posted = payload(await mod.runPosthogApi({ method: 'POST', path: '/api/projects/' }));
    expect(posted.isError).toBe(true);
    expect(posted.body.error).toMatch(/write=true/);
    const getBody = payload(
      await mod.runPosthogApi({ method: 'GET', path: '/api/users/@me/', body: {} }),
    );
    expect(getBody.body.error).toMatch(/does not take a body/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says PostHog is not connected before calling the network', async () => {
    const mod = await load();
    const fetchImpl = vi.fn();
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const result = payload(
      await mod.runPosthogApi({ method: 'GET', path: '/api/users/@me/' }),
    );
    expect(result.isError).toBe(true);
    expect(result.body.error).toMatch(/not connected/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('GETs the stored host with the vault token', async () => {
    const mod = await load();
    mod.settings.updateIntegrationsSettings({
      posthogPersonalApiKey: 'phx_test',
      posthogHost: 'https://eu.posthog.com',
    });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ email: 'matt@acme' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const result = payload(
      await mod.runPosthogApi({
        method: 'GET',
        path: '/api/users/@me/',
        query: { limit: '1' },
      }),
    );
    expect(result.isError).toBe(false);
    expect(result.body.status).toBe(200);
    expect(result.body.body).toEqual({ email: 'matt@acme' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://eu.posthog.com/api/users/@me/?limit=1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer phx_test');
    expect(init.method).toBe('GET');
  });

  it('POSTs the query API without write=true', async () => {
    const mod = await load();
    mod.settings.updateIntegrationsSettings({ posthogPersonalApiKey: 'phx_test' });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: [[1]] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const result = payload(
      await mod.runPosthogApi({
        method: 'POST',
        path: '/api/projects/1/query/',
        body: { query: { kind: 'HogQLQuery', query: 'select 1' } },
      }),
    );
    expect(result.isError).toBe(false);
    expect(result.body.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://us.posthog.com/api/projects/1/query/');
    expect(init.method).toBe('POST');
    expect(mod.isPosthogReadQuery('POST', '/api/projects/1/query')).toBe(true);
    expect(mod.isPosthogReadQuery('POST', '/api/environments/2/query/')).toBe(true);
    expect(mod.isPosthogReadQuery('PATCH', '/api/projects/1/query/')).toBe(false);
    const unsuffixed = payload(
      await mod.runPosthogApi({
        method: 'POST',
        path: '/api/environments/2/query',
        body: { query: { kind: 'HogQLQuery', query: 'select 1' } },
      }),
    );
    expect(unsuffixed.isError).toBe(false);
    const [envUrl, envInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(envUrl).toBe('https://us.posthog.com/api/environments/2/query/');
    expect(envInit.method).toBe('POST');
    expect(envInit.body).toBe(JSON.stringify({ query: { kind: 'HogQLQuery', query: 'select 1' } }));
    const nested = payload(
      await mod.runPosthogApi({ method: 'POST', path: '/api/projects/1/query/export' }),
    );
    expect(nested.isError).toBe(true);
    expect(nested.body.error).toMatch(/write=true/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('POSTs only when write=true', async () => {
    const mod = await load();
    mod.settings.updateIntegrationsSettings({ posthogPersonalApiKey: 'phx_test' });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const result = payload(
      await mod.runPosthogApi({
        method: 'POST',
        path: '/api/projects/1/annotations/',
        write: true,
        body: { content: 'shipped' },
      }),
    );
    expect(result.body.status).toBe(201);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://us.posthog.com/api/projects/1/annotations/');
    expect(init.body).toBe(JSON.stringify({ content: 'shipped' }));
  });
});
