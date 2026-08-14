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
    expect(
      resolveSlackListenMode({
        relayUrl: 'ws://127.0.0.1:9/slack/desktop',
        workspaceCount: 1,
      }),
    ).toBe('relay');
  });

  it('uses relay when a workspace is connected', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-listen-mode-'));
    delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    const { resolveSlackListenMode } = await import('./listen.js');
    expect(
      resolveSlackListenMode({
        relayUrl: 'ws://127.0.0.1:9/slack/desktop',
        workspaceCount: 1,
      }),
    ).toBe('relay');
  });

  it('returns null with no workspaces', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-listen-mode-'));
    delete process.env.SIDEBOARD_SLACK_APP_TOKEN;
    const { resolveSlackListenMode } = await import('./listen.js');
    expect(
      resolveSlackListenMode({
        relayUrl: 'ws://127.0.0.1:9/slack/desktop',
        workspaceCount: 0,
      }),
    ).toBeNull();
  });
});
