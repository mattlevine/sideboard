import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('slack workspaces store', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dir = '';

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load() {
    dir = mkdtempSync(join(tmpdir(), 'sb-slack-'));
    process.env.SIDEBOARD_APP_DATA = dir;
    return import('./workspaces.js');
  }

  it('upserts by team_id and lists without tokens', async () => {
    const mod = await load();
    mod.upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      bot_token: 'xoxb-secret',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    const listed = mod.listSlackWorkspaces();
    expect(listed).toEqual([
      {
        team_id: 'T1',
        team_name: 'Acme',
        user_id: undefined,
        has_bot_token: true,
        has_user_token: false,
        connected_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const raw = readFileSync(join(dir, 'slack-workspaces.json'), 'utf8');
    expect(raw).toContain('xoxb-secret');
    expect(mod.getSlackWorkspace('T1')?.bot_token).toBe('xoxb-secret');
  });

  it('connectSlackToken stores bot vs user tokens from auth.test', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const auth = String(init?.headers?.Authorization ?? '');
      return {
        ok: true,
        json: async () =>
          auth.includes('xoxb-')
            ? {
                ok: true,
                team: 'Acme',
                team_id: 'T99',
                user_id: 'U1',
                bot_id: 'B1',
              }
            : {
                ok: true,
                team: 'Acme',
                team_id: 'T99',
                user_id: 'U1',
              },
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await load();
    await mod.connectSlackToken('xoxb-bot');
    await mod.connectSlackToken('xoxp-user');
    const ws = mod.getSlackWorkspace('T99');
    expect(ws?.bot_token).toBe('xoxb-bot');
    expect(ws?.user_token).toBe('xoxp-user');
    expect(mod.slackTokenFor(ws!, 'write')).toBe('xoxb-bot');
    expect(mod.slackTokenFor(ws!, 'read')).toBe('xoxb-bot');
  });

  it('keeps the listen grant and OAuth user when a bot token is pasted', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        team: 'Acme',
        team_id: 'T1',
        user_id: 'UBOT',
        bot_id: 'B1',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await load();
    mod.upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      user_id: 'UHUMAN',
      bot_token: 'xoxb-old',
      listen_grant: 'grant-1',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    await mod.connectSlackToken('xoxb-new');
    const ws = mod.getSlackWorkspace('T1');
    expect(ws?.bot_token).toBe('xoxb-new');
    expect(ws?.user_id).toBe('UHUMAN');
    expect(ws?.listen_grant).toBe('grant-1');
  });

  it('disconnect removes a team', async () => {
    const mod = await load();
    mod.upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'A',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    expect(mod.disconnectSlackWorkspace('T1')).toEqual([]);
  });
});
