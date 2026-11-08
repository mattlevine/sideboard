import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('resolveSlackListenMode', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  const prevToken = process.env.SIDEBOARD_SLACK_APP_TOKEN;
  const prevRelay = process.env.SIDEBOARD_SLACK_RELAY_URL;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    if (prevToken === undefined) delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    else process.env.SIDEBOARD_SLACK_APP_TOKEN = prevToken;
    if (prevRelay === undefined) delete process.env.SIDEBOARD_SLACK_RELAY_URL;
    else process.env.SIDEBOARD_SLACK_RELAY_URL = prevRelay;
    vi.resetModules();
  });

  it('does not use local Socket Mode even if xapp- is set', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-listen-mode-'));
    process.env.SIDEBOARD_SLACK_APP_TOKEN = 'xapp-local';
    delete process.env.SIDEBOARD_SLACK_RELAY_URL;
    const { resolveSlackListenMode } = await import('./listen.js');
    const { upsertSlackWorkspace } = await import('./workspaces.js');
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      user_id: 'U1',
      bot_token: 'xoxb',
      listen_grant: 'grant',
      connected_at: new Date().toISOString(),
    });
    expect(resolveSlackListenMode({ relayUrl: 'ws://127.0.0.1:9/slack/desktop' })).toBe('relay');
  });

  it('uses relay when OAuth proved the Slack user', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-listen-mode-'));
    delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    const { resolveSlackListenMode } = await import('./listen.js');
    const { upsertSlackWorkspace } = await import('./workspaces.js');
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      user_id: 'U1',
      bot_token: 'xoxb',
      listen_grant: 'grant',
      connected_at: new Date().toISOString(),
    });
    expect(resolveSlackListenMode({ relayUrl: 'ws://127.0.0.1:9/slack/desktop' })).toBe('relay');
  });

  it('stays off when the workspace has only a bot token', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-listen-mode-'));
    delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    const { resolveSlackListenMode } = await import('./listen.js');
    const { upsertSlackWorkspace } = await import('./workspaces.js');
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      user_id: 'B1',
      bot_token: 'xoxb',
      connected_at: new Date().toISOString(),
    });
    expect(resolveSlackListenMode({ relayUrl: 'ws://127.0.0.1:9/slack/desktop' })).toBeNull();
  });

  it('returns null with no workspaces', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-listen-mode-'));
    delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    const { resolveSlackListenMode } = await import('./listen.js');
    expect(resolveSlackListenMode({ relayUrl: 'ws://127.0.0.1:9/slack/desktop' })).toBeNull();
  });
});
