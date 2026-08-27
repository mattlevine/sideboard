import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  brightsyAccessTokenNeedsRefresh,
  ensureBrightsyLocalConfigFresh,
  refreshBrightsyAccessToken,
} from './oauth.js';

describe('brightsyAccessTokenNeedsRefresh', () => {
  it('refreshes when expiry is missing or invalid', () => {
    expect(brightsyAccessTokenNeedsRefresh(undefined)).toBe(true);
    expect(brightsyAccessTokenNeedsRefresh(0)).toBe(true);
    expect(brightsyAccessTokenNeedsRefresh(Number.NaN)).toBe(true);
  });

  it('refreshes within 60s of expiry', () => {
    const now = 1_000_000;
    expect(brightsyAccessTokenNeedsRefresh(now + 30_000, now)).toBe(true);
    expect(brightsyAccessTokenNeedsRefresh(now + 120_000, now)).toBe(false);
  });
});

describe('refreshBrightsyAccessToken', () => {
  it('posts the refresh grant and returns the new tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    });
    const grant = await refreshBrightsyAccessToken({
      endpoint: 'https://brightsy.ai/',
      refreshToken: 'old-refresh',
      clientId: 'brightsy-cli',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(grant?.access_token).toBe('new-access');
    expect(grant?.refresh_token).toBe('new-refresh');
    expect(grant?.expires_at).toBeGreaterThan(Date.now());
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('grant_type=refresh_token');
    expect(String(init.body)).toContain('refresh_token=old-refresh');
  });

  it('returns null when the server rejects the grant', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(
      refreshBrightsyAccessToken({
        endpoint: 'https://brightsy.ai',
        refreshToken: 'dead',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
  });
});

describe('ensureBrightsyLocalConfigFresh', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sb-brightsy-home-'));
    mkdirSync(join(home, '.brightsy'), { recursive: true });
    vi.stubEnv('BRIGHTSY_CONFIG', join(home, '.brightsy', 'config.json'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('refreshes ~/.brightsy when expires_at is missing', async () => {
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'stale',
        refresh_token: 'r1',
        account_id: 'acct',
        endpoint: 'https://brightsy.ai',
      }),
    );
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh',
        refresh_token: 'r2',
        expires_in: 3600,
      }),
    });
    const next = await ensureBrightsyLocalConfigFresh({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(next?.access_token).toBe('fresh');
    expect(next?.refresh_token).toBe('r2');
    const saved = JSON.parse(readFileSync(process.env.BRIGHTSY_CONFIG!, 'utf8')) as {
      access_token: string;
    };
    expect(saved.access_token).toBe('fresh');
  });

  it('skips the network when the access token is still fresh', async () => {
    writeFileSync(
      process.env.BRIGHTSY_CONFIG!,
      JSON.stringify({
        access_token: 'ok',
        refresh_token: 'r1',
        account_id: 'acct',
        expires_at: Date.now() + 10 * 60_000,
      }),
    );
    const fetchImpl = vi.fn();
    const next = await ensureBrightsyLocalConfigFresh({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(next?.access_token).toBe('ok');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
