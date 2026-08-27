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
});
