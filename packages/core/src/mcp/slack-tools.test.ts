import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendGithubLink } from '../slack/github-link.js';
import { resolveSlackDestination } from '../slack/destination.js';

/**
 * End-to-end shape of slack_post: resolve user → open DM → body with github link.
 * (MCP registration is covered indirectly; this mirrors the tool's call sequence.)
 */
describe('slack_post notify flow', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('opens a DM then posts with a GitHub PR link in the body', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-post-'));
    const { upsertSlackWorkspace, slackTokenFor, getSlackWorkspace } = await import(
      '../slack/workspaces.js'
    );
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      bot_token: 'xoxb-bot',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    const ws = getSlackWorkspace('T1')!;
    const token = slackTokenFor(ws, 'write');

    const calls: Array<{ method: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = url.replace(/^.*\/api\//, '');
      const body = String(init?.body ?? '');
      calls.push({ method, body });
      if (method === 'users.list') {
        return {
          json: async () => ({
            ok: true,
            members: [{ id: 'Umatt', name: 'matt', profile: { display_name: 'Matt' } }],
            response_metadata: { next_cursor: '' },
          }),
        };
      }
      if (method === 'conversations.open') {
        return { json: async () => ({ ok: true, channel: { id: 'Ddm' } }) };
      }
      if (method === 'chat.postMessage') {
        return { json: async () => ({ ok: true, ts: '9.9', channel: 'Ddm' }) };
      }
      throw new Error(`unexpected ${method}`);
    });

    const dest = await resolveSlackDestination(token, '@matt', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const message = appendGithubLink(
      'PR is ready',
      'https://github.com/acme/app/pull/42',
    );
    const { slackApi } = await import('../slack/api.js');
    const posted = await slackApi<{ ts?: string; channel?: string }>(
      token,
      'chat.postMessage',
      {
        channel: dest.channelId,
        text: message,
        unfurl_links: true,
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(dest.channelId).toBe('Ddm');
    expect(message).toContain('<https://github.com/acme/app/pull/42|PR #42>');
    expect(posted.ts).toBe('9.9');
    expect(calls.some((c) => c.method === 'conversations.open')).toBe(true);
    const post = calls.find((c) => c.method === 'chat.postMessage');
    expect(post?.body).toContain('channel=Ddm');
    expect(post?.body).toContain('PR+is+ready');
    expect(post?.body).toContain('unfurl_links=true');
  });
});
