import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrightsySideboardApi, formatBrightsyFetchError } from './api.js';

describe('formatBrightsyFetchError', () => {
  it('includes URL and undici cause code', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND brightsy.ai'), {
      code: 'ENOTFOUND',
    });
    const err = Object.assign(new TypeError('fetch failed'), { cause });
    expect(formatBrightsyFetchError(err, 'https://brightsy.ai/api/v1beta/desktop/tasks')).toBe(
      'fetch failed [ENOTFOUND: getaddrinfo ENOTFOUND brightsy.ai] (https://brightsy.ai/api/v1beta/desktop/tasks)',
    );
  });
});

describe('BrightsySideboardApi.ensureFreshAccessToken', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-brightsy-api-'));
    vi.stubEnv('BRIGHTSY_CONFIG', join(dataDir, 'brightsy-config.json'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('registers a DCR client before cloud refresh when oauth_client_id is missing', async () => {
    writeFileSync(
      join(dataDir, 'brightsy-config.json'),
      JSON.stringify({
        access_token: 'stale',
        refresh_token: 'r1',
        account_id: 'acct',
        endpoint: 'https://brightsy.ai',
      }),
    );
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/oauth/register')) {
        return { ok: true, json: async () => ({ client_id: 'sideboard-dcr' }) };
      }
      if (String(url).endsWith('/oauth/token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'fresh',
            refresh_token: 'r2',
            expires_in: 3600,
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const api = new BrightsySideboardApi({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await api.ensureFreshAccessToken();
    const [, tokenInit] = fetchImpl.mock.calls.find(
      (call) => String(call[0]).endsWith('/oauth/token'),
    ) as [string, RequestInit];
    expect(String(tokenInit.body)).toContain('client_id=sideboard-dcr');
    const saved = JSON.parse(readFileSync(join(dataDir, 'brightsy-config.json'), 'utf8')) as {
      access_token: string;
      oauth_client_id?: string;
    };
    expect(saved.access_token).toBe('fresh');
    expect(saved.oauth_client_id).toBe('sideboard-dcr');
  });
});
