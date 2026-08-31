import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('optional services', () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    vi.resetModules();
  });

  async function load() {
    const home = mkdtempSync(join(tmpdir(), 'sb-optional-svc-'));
    process.env.HOME = home;
    const [mod, fetchMod] = await Promise.all([
      import('./optional-services.js'),
      import('../http/fetch.js'),
    ]);
    return { ...mod, setHttpFetchImpl: fetchMod.setHttpFetchImpl };
  }

  it('tells agents to use official CLIs and skip vendor MCPs', async () => {
    const mod = await load();
    expect(mod.formatOptionalServicesDirective({})).toBeNull();
    expect(mod.formatOptionalServicesReminder({})).toBeNull();

    const text = mod.formatOptionalServicesDirective({
      vercelToken: 'v',
      supabaseAccessToken: 's',
      posthogPersonalApiKey: 'p',
      sentryAuthToken: 't',
    });
    expect(text).toMatch(/`vercel` CLI/);
    expect(text).toMatch(/`supabase` CLI/);
    expect(text).toMatch(/`sentry-cli`/);
    expect(text).toMatch(/PostHog: no first-class CLI/);
    expect(text).toMatch(/Do not add a Vercel MCP/);
    expect(text).toMatch(/Do not ask the user to install a vendor MCP/);
    expect(text).toMatch(/Install CLI from Settings → Connectors/);
    expect(mod.formatOptionalServicesReminder({ vercelToken: 'v' })).toMatch(
      /Do not add vendor MCPs/,
    );
  });

  it('normalizes service origins', async () => {
    const mod = await load();
    expect(mod.normalizeServiceOrigin(undefined, 'https://sentry.io')).toBe(
      'https://sentry.io',
    );
    expect(mod.normalizeServiceOrigin('eu.posthog.com', 'https://us.posthog.com')).toBe(
      'https://eu.posthog.com',
    );
    expect(mod.normalizeServiceOrigin('https://acme.sentry.io/', 'https://sentry.io')).toBe(
      'https://acme.sentry.io',
    );
    expect(mod.normalizeServiceOrigin('ftp://bad', 'https://sentry.io')).toBe(
      'https://sentry.io',
    );
  });

  it('connects Vercel after a successful user lookup and vaults the token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ user: { username: 'matt', name: 'Matt' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const mod = await load();
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const saved = await mod.connectOptionalService({
      id: 'vercel',
      token: 'vercel_live_test',
    });
    expect(saved.integrations.vercelToken).toBe('vercel_live_test');
    expect(saved.integrations.vercelViewerName).toBe('matt');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.vercel.com/v2/user');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer vercel_live_test',
    );

    const settings = await import('../store/app-settings.js');
    const pub = settings.toPublicAppSettings(settings.loadAppSettings());
    expect(pub.integrations.hasVercelToken).toBe(true);
    expect(pub.integrations.vercelViewerName).toBe('matt');
    expect((pub.integrations as { vercelToken?: string }).vercelToken).toBeUndefined();

    const cleared = mod.disconnectOptionalService('vercel');
    expect(cleared.integrations.vercelToken).toBeUndefined();
    expect(cleared.integrations.vercelViewerName).toBeUndefined();
  });

  it('connects Supabase after listing organizations', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([{ name: "mattlevine's Org" }, { name: 'Reventure Labs' }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const mod = await load();
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const saved = await mod.connectOptionalService({
      id: 'supabase',
      token: 'sbp_test',
    });
    expect(saved.integrations.supabaseAccessToken).toBe('sbp_test');
    expect(saved.integrations.supabaseViewerName).toBe("mattlevine's Org +1");
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.supabase.com/v1/organizations');
  });

  it('clears PostHog host on disconnect so agent env is not left pointed at the old origin', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ email: 'matt@acme' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const mod = await load();
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const saved = await mod.connectOptionalService({
      id: 'posthog',
      token: 'phx_test',
      host: 'eu.posthog.com',
    });
    expect(saved.integrations.posthogHost).toBe('https://eu.posthog.com');
    expect(saved.integrations.posthogViewerName).toBe('matt@acme');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://eu.posthog.com/api/users/@me/');

    const cleared = mod.disconnectOptionalService('posthog');
    expect(cleared.integrations.posthogPersonalApiKey).toBeUndefined();
    expect(cleared.integrations.posthogViewerName).toBeUndefined();
    expect(cleared.integrations.posthogHost).toBeUndefined();

    const settings = await import('../store/app-settings.js');
    const target: NodeJS.ProcessEnv = {};
    settings.applyAppEnvironment(target);
    expect(target.POSTHOG_PERSONAL_API_KEY).toBeUndefined();
    expect(target.POSTHOG_HOST).toBeUndefined();
  });

  it('rejects a bad PostHog token without persisting', async () => {
    const mod = await load();
    mod.setHttpFetchImpl(
      vi.fn(async () => new Response(JSON.stringify({ detail: 'Invalid token' }), { status: 401 })) as unknown as typeof fetch,
    );
    await expect(
      mod.connectOptionalService({ id: 'posthog', token: 'phx_bad' }),
    ).rejects.toThrow(/PostHog rejected this token/);
    const settings = await import('../store/app-settings.js');
    expect(settings.loadAppSettings().integrations.posthogPersonalApiKey).toBeUndefined();
  });

  it('connects Sentry with a custom host', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([{ slug: 'acme', name: 'Acme' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const mod = await load();
    mod.setHttpFetchImpl(fetchImpl as unknown as typeof fetch);
    const saved = await mod.connectOptionalService({
      id: 'sentry',
      token: 'sentry_test',
      host: 'acme.sentry.io',
    });
    expect(saved.integrations.sentryAuthToken).toBe('sentry_test');
    expect(saved.integrations.sentryHost).toBe('https://acme.sentry.io');
    expect(saved.integrations.sentryViewerName).toBe('acme');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://acme.sentry.io/api/0/organizations/');

    const cleared = mod.disconnectOptionalService('sentry');
    expect(cleared.integrations.sentryAuthToken).toBeUndefined();
    expect(cleared.integrations.sentryViewerName).toBeUndefined();
    expect(cleared.integrations.sentryHost).toBeUndefined();

    const settings = await import('../store/app-settings.js');
    const target: NodeJS.ProcessEnv = {};
    settings.applyAppEnvironment(target);
    expect(target.SENTRY_AUTH_TOKEN).toBeUndefined();
    expect(target.SENTRY_URL).toBeUndefined();
  });
});
