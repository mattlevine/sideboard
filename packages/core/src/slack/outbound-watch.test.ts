import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('slack outbound reply badges', () => {
  const prev = process.env.SIDEBOARD_APP_DATA;
  const prevVault = process.env.SIDEBOARD_SECRET_VAULT;

  afterEach(() => {
    if (prev === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prev;
    if (prevVault === undefined) delete process.env.SIDEBOARD_SECRET_VAULT;
    else process.env.SIDEBOARD_SECRET_VAULT = prevVault;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load() {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-watch-'));
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
    const watch = await import('./outbound-watch.js');
    watch.resetSlackOutboundWatchStateForTests();
    const workspaces = await import('./workspaces.js');
    workspaces.upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      user_id: 'Ume',
      bot_token: 'xoxb-bot',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    return watch;
  }

  function fetchImpl(replies: unknown[], history: unknown[]) {
    return vi.fn(async (url: string) => {
      const method = url.replace(/^.*\/api\//, '');
      if (method === 'conversations.replies') {
        return { json: async () => ({ ok: true, messages: replies }) };
      }
      if (method === 'conversations.history') {
        return { json: async () => ({ ok: true, messages: history }) };
      }
      if (method === 'chat.getPermalink') {
        return {
          json: async () => ({
            ok: true,
            permalink: 'https://acme.slack.com/archives/Ddm/p111000200',
          }),
        };
      }
      if (method === 'users.info') {
        return {
          json: async () => ({
            ok: true,
            user: { id: 'Ualice', name: 'alice', profile: { display_name: 'Alice' } },
          }),
        };
      }
      throw new Error(`unexpected ${method}`);
    });
  }

  it('builds an archive permalink from channel + ts', async () => {
    const { slackArchiveUrl, initialsFromName } = await load();
    expect(slackArchiveUrl('C123', '1712345678.123456')).toBe(
      'https://slack.com/archives/C123/p1712345678123456',
    );
    expect(initialsFromName('Alice Chen')).toBe('AC');
    expect(initialsFromName('bob')).toBe('BO');
  });

  it('does not watch a notify sent to the owner', async () => {
    const { recordSlackOutboundWatch, listSlackReplyBadges } = await load();
    expect(
      recordSlackOutboundWatch({
        teamId: 'T1',
        channelId: 'Dme',
        ts: '1.1',
        kind: 'dm',
        toUserId: 'Ume',
        toLabel: '@me',
        ownerUserId: 'Ume',
      }),
    ).toBeNull();
    expect(listSlackReplyBadges()).toEqual([]);
  });

  it('badges when another user replies in a DM, then dismisses until a later reply', async () => {
    const {
      recordSlackOutboundWatch,
      refreshSlackReplyBadges,
      dismissSlackReplyBadge,
      listSlackReplyBadges,
      resetSlackOutboundWatchStateForTests,
    } = await load();

    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '10.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
    });
    expect(listSlackReplyBadges()).toEqual([]);

    const badges = await refreshSlackReplyBadges({
      force: true,
      fetchImpl: fetchImpl(
        [],
        [
          { ts: '10.0', bot_id: 'Bbot', text: 'original' },
          { ts: '11.0', user: 'Ume', text: 'my follow-up' },
          { ts: '12.0', user: 'Ualice', text: 'looks good' },
        ],
      ) as unknown as typeof fetch,
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.userName).toBe('Alice');
    expect(badges[0]?.initials).toBe('AL');
    expect(badges[0]?.permalink).toContain('slack.com');
    expect(badges[0]?.id).toBe('T1:Ualice');

    const afterDismiss = dismissSlackReplyBadge('T1:Ualice');
    expect(afterDismiss).toEqual([]);

    resetSlackOutboundWatchStateForTests();
    const again = await refreshSlackReplyBadges({
      force: true,
      fetchImpl: fetchImpl(
        [],
        [
          { ts: '12.0', user: 'Ualice', text: 'looks good' },
          { ts: '13.0', user: 'Ualice', text: 'one more thing' },
        ],
      ) as unknown as typeof fetch,
    });
    expect(again).toHaveLength(1);
    expect(again[0]?.preview).toBe('one more thing');
  });

  it('skips bot messages and owner messages in a channel thread', async () => {
    const { recordSlackOutboundWatch, refreshSlackReplyBadges } = await load();
    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ceng',
      ts: '20.0',
      kind: 'channel',
      toLabel: '#eng',
      ownerUserId: 'Ume',
    });
    const badges = await refreshSlackReplyBadges({
      force: true,
      fetchImpl: fetchImpl(
        [
          { ts: '20.0', bot_id: 'Bbot', text: 'notify' },
          { ts: '21.0', user: 'Ume', text: 'owner in thread' },
          { ts: '21.5', subtype: 'channel_join', user: 'Ualice' },
          { ts: '22.0', bot_id: 'Bbot', text: 'bot again' },
        ],
        [],
      ) as unknown as typeof fetch,
    });
    expect(badges).toEqual([]);
  });

  it('collapses two unread watches from the same user into one badge', async () => {
    const { recordSlackOutboundWatch, refreshSlackReplyBadges } = await load();
    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '30.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
    });
    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '31.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
    });
    const badges = await refreshSlackReplyBadges({
      force: true,
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        const method = url.replace(/^.*\/api\//, '');
        const body = String(init?.body ?? '');
        if (method === 'conversations.replies') {
          return { json: async () => ({ ok: true, messages: [] }) };
        }
        if (method === 'conversations.history') {
          const oldest = new URLSearchParams(body).get('oldest');
          const ts = oldest === '30.0' ? '30.5' : '31.5';
          return {
            json: async () => ({
              ok: true,
              messages: [{ ts, user: 'Ualice', text: `reply to ${oldest}` }],
            }),
          };
        }
        if (method === 'chat.getPermalink') {
          const ts = new URLSearchParams(body).get('message_ts') ?? '1';
          return {
            json: async () => ({
              ok: true,
              permalink: `https://acme.slack.com/archives/Ddm/p${ts.replace('.', '')}`,
            }),
          };
        }
        if (method === 'users.info') {
          return {
            json: async () => ({
              ok: true,
              user: { name: 'alice', profile: { display_name: 'Alice' } },
            }),
          };
        }
        throw new Error(`unexpected ${method}`);
      }) as unknown as typeof fetch,
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.userId).toBe('Ualice');
  });
});
