import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ensureConnectedBrightsyTeamTokens', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-brightsy-teams-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
    vi.stubEnv('BRIGHTSY_CONFIG', join(dataDir, 'brightsy-config.json'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('refreshes a team token when expires_at is missing', async () => {
    writeFileSync(
      join(dataDir, 'brightsy-teams.json'),
      JSON.stringify({
        teams: [
          {
            id: 'team-1',
            slug: 'acme',
            name: 'Acme',
            access_token: 'stale',
            refresh_token: 'r1',
            endpoint: 'https://brightsy.ai',
          },
        ],
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh',
          refresh_token: 'r2',
          expires_in: 3600,
        }),
      }),
    );
    const { ensureConnectedBrightsyTeamTokens } = await import('./connected-teams.js');
    const teams = await ensureConnectedBrightsyTeamTokens();
    expect(teams[0]?.access_token).toBe('fresh');
    expect(teams[0]?.refresh_token).toBe('r2');
    const saved = JSON.parse(readFileSync(join(dataDir, 'brightsy-teams.json'), 'utf8')) as {
      teams: Array<{ access_token: string }>;
    };
    expect(saved.teams[0]?.access_token).toBe('fresh');
  });

  it('does not refresh a token that is still valid', async () => {
    writeFileSync(
      join(dataDir, 'brightsy-teams.json'),
      JSON.stringify({
        teams: [
          {
            id: 'team-1',
            slug: 'acme',
            name: 'Acme',
            access_token: 'ok',
            refresh_token: 'r1',
            expires_at: Date.now() + 10 * 60_000,
            oauth_client_id: 'already',
            endpoint: 'https://brightsy.ai',
          },
        ],
      }),
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const { ensureConnectedBrightsyTeamTokens } = await import('./connected-teams.js');
    const teams = await ensureConnectedBrightsyTeamTokens();
    expect(teams[0]?.access_token).toBe('ok');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('backfills oauth_client_id via DCR when the access token is still valid', async () => {
    writeFileSync(
      join(dataDir, 'brightsy-teams.json'),
      JSON.stringify({
        teams: [
          {
            id: 'team-1',
            slug: 'acme',
            name: 'Acme',
            access_token: 'ok',
            refresh_token: 'r1',
            expires_at: Date.now() + 10 * 60_000,
            endpoint: 'https://brightsy.ai',
          },
        ],
      }),
    );
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/oauth/register')) {
        return { ok: true, json: async () => ({ client_id: 'sideboard-dcr' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    const { ensureConnectedBrightsyTeamTokens } = await import('./connected-teams.js');
    const teams = await ensureConnectedBrightsyTeamTokens({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(teams[0]?.access_token).toBe('ok');
    expect(teams[0]?.oauth_client_id).toBe('sideboard-dcr');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(readFileSync(join(dataDir, 'brightsy-teams.json'), 'utf8')) as {
      teams: Array<{ oauth_client_id?: string }>;
    };
    expect(saved.teams[0]?.oauth_client_id).toBe('sideboard-dcr');
  });

  it('registers a DCR client before refreshing a team without oauth_client_id', async () => {
    writeFileSync(
      join(dataDir, 'brightsy-teams.json'),
      JSON.stringify({
        teams: [
          {
            id: 'team-1',
            slug: 'acme',
            name: 'Acme',
            access_token: 'stale',
            refresh_token: 'r1',
            endpoint: 'https://brightsy.ai',
          },
        ],
      }),
    );
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/oauth/register')) {
        return { ok: true, json: async () => ({ client_id: 'sideboard-dcr' }) };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'fresh',
          refresh_token: 'r2',
          expires_in: 3600,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchImpl);
    const { ensureConnectedBrightsyTeamTokens } = await import('./connected-teams.js');
    const teams = await ensureConnectedBrightsyTeamTokens({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(teams[0]?.access_token).toBe('fresh');
    expect(teams[0]?.oauth_client_id).toBe('sideboard-dcr');
    const [, tokenInit] = fetchImpl.mock.calls.find(
      (call) => String(call[0]).endsWith('/oauth/token'),
    ) as [string, RequestInit];
    expect(String(tokenInit.body)).toContain('client_id=sideboard-dcr');
  });

  it('adopts a fresher CLI login instead of overwriting ~/.brightsy', async () => {
    const now = Date.now();
    writeFileSync(
      join(dataDir, 'brightsy-teams.json'),
      JSON.stringify({
        teams: [
          {
            id: 'team-1',
            slug: 'acme',
            name: 'Acme',
            access_token: 'stale',
            refresh_token: 'old-refresh',
            expires_at: now - 60_000,
            endpoint: 'https://brightsy.ai',
          },
        ],
      }),
    );
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'fresh-login',
        refresh_token: 'new-refresh',
        account_id: 'team-1',
        account_slug: 'acme',
        expires_at: now + 60 * 60_000,
        endpoint: 'https://brightsy.ai',
        oauth_client_id: 'cli-dcr',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    const { ensureConnectedBrightsyTeamTokens } = await import('./connected-teams.js');
    const teams = await ensureConnectedBrightsyTeamTokens();
    expect(teams[0]?.access_token).toBe('fresh-login');
    expect(teams[0]?.refresh_token).toBe('new-refresh');
    expect(teams[0]?.oauth_client_id).toBe('cli-dcr');
    const cli = JSON.parse(readFileSync(process.env.BRIGHTSY_CONFIG!, 'utf8')) as {
      access_token: string;
    };
    expect(cli.access_token).toBe('fresh-login');
    const saved = JSON.parse(readFileSync(join(dataDir, 'brightsy-teams.json'), 'utf8')) as {
      teams: Array<{ access_token: string }>;
    };
    expect(saved.teams[0]?.access_token).toBe('fresh-login');
  });

  it('still copies a fresher team-store session onto ~/.brightsy', async () => {
    const now = Date.now();
    writeFileSync(
      join(dataDir, 'brightsy-teams.json'),
      JSON.stringify({
        teams: [
          {
            id: 'team-1',
            slug: 'acme',
            name: 'Acme',
            access_token: 'store-fresh',
            refresh_token: 'store-refresh',
            expires_at: now + 60 * 60_000,
            endpoint: 'https://brightsy.ai',
          },
        ],
      }),
    );
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'cli-stale',
        refresh_token: 'cli-refresh',
        account_id: 'team-1',
        expires_at: now - 60_000,
        endpoint: 'https://brightsy.ai',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    const { ensureConnectedBrightsyTeamTokens } = await import('./connected-teams.js');
    await ensureConnectedBrightsyTeamTokens();
    const cli = JSON.parse(readFileSync(process.env.BRIGHTSY_CONFIG!, 'utf8')) as {
      access_token: string;
    };
    expect(cli.access_token).toBe('store-fresh');
  });
});

describe('brightsySessionShouldReplace', () => {
  it('replaces an expired store session with a live CLI login', async () => {
    const { brightsySessionShouldReplace } = await import('./connected-teams.js');
    const now = Date.now();
    expect(
      brightsySessionShouldReplace(
        { access_token: 'fresh', expires_at: now + 10 * 60_000 },
        { access_token: 'stale', expires_at: now - 60_000 },
      ),
    ).toBe(true);
    expect(
      brightsySessionShouldReplace(
        { access_token: 'stale', expires_at: now - 60_000 },
        { access_token: 'fresh', expires_at: now + 10 * 60_000 },
      ),
    ).toBe(false);
  });
});
