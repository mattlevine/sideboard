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

  it('prefers the bot token and falls back to a stored user token', async () => {
    const mod = await load();
    mod.upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      bot_token: 'xoxb-bot',
      user_token: 'xoxp-user',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    const both = mod.getSlackWorkspace('T1')!;
    expect(mod.slackTokenFor(both, 'write')).toBe('xoxb-bot');
    expect(mod.slackTokenFor(both, 'read')).toBe('xoxb-bot');
    mod.upsertSlackWorkspace({
      team_id: 'T2',
      team_name: 'Legacy',
      user_token: 'xoxp-only',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    expect(mod.slackTokenFor(mod.getSlackWorkspace('T2')!, 'read')).toBe('xoxp-only');
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
