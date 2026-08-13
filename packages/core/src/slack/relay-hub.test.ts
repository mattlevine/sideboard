import { describe, expect, it, vi } from 'vitest';
import { SlackRelayHub } from './relay-hub.js';
import type { SlackInboundMessage } from './socket-mode.js';

function fakeSocket() {
  const sent: string[] = [];
  return {
    sent,
    socket: {
      send: (data: string) => {
        sent.push(data);
      },
      close: vi.fn(),
    },
  };
}

describe('SlackRelayHub', () => {
  it('rejects register when user token identity does not match claimed user', async () => {
    const { socket, sent } = fakeSocket();
    const hub = new SlackRelayHub({
      authTest: async (token) =>
        token.startsWith('xoxp-')
          ? { ok: true, team_id: 'T1', user_id: 'U_OTHER' }
          : { ok: true, team_id: 'T1', user_id: 'Bbot' },
    });
    await hub.register(socket, 'T1', 'Umatt', 'dev-personal', 'Personal', 'xoxb-bot', 'xoxp-user');
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('does not match'),
    });
    expect(hub.sessionFor('T1', 'Umatt', 'dev-personal')).toBeNull();
  });

  it('rejects register when bot token team does not match', async () => {
    const { socket, sent } = fakeSocket();
    const hub = new SlackRelayHub({
      authTest: async (token) =>
        token.startsWith('xoxp-')
          ? { ok: true, team_id: 'T1', user_id: 'Umatt' }
          : { ok: true, team_id: 'T_OTHER', user_id: 'Bbot' },
    });
    await hub.register(socket, 'T1', 'Umatt', 'dev-personal', 'Personal', 'xoxb-bot', 'xoxp-user');
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('Bot token team_id'),
    });
  });

  it('routes events only to the matching Slack user desktop', async () => {
    const matt = fakeSocket();
    const alice = fakeSocket();
    const hub = new SlackRelayHub({
      authTest: async (token) => {
        if (token.includes('matt-user')) {
          return { ok: true, team_id: 'T1', user_id: 'Umatt' };
        }
        if (token.includes('alice-user')) {
          return { ok: true, team_id: 'T1', user_id: 'Ualice' };
        }
        return { ok: true, team_id: 'T1', user_id: 'Bbot' };
      },
    });
    await hub.register(
      matt.socket,
      'T1',
      'Umatt',
      'matt-mac',
      'Personal',
      'xoxb-bot',
      'xoxp-matt-user',
    );
    await hub.register(
      alice.socket,
      'T1',
      'Ualice',
      'alice-mac',
      'Work',
      'xoxb-bot',
      'xoxp-alice-user',
    );
    expect(JSON.parse(matt.sent[0]!)).toEqual({
      type: 'registered',
      teamId: 'T1',
      userId: 'Umatt',
      deviceId: 'matt-mac',
    });

    const mattEvent: SlackInboundMessage = {
      teamId: 'T1',
      channelId: 'D1',
      ts: '1.0',
      userId: 'Umatt',
      text: 'hello',
      kind: 'dm',
    };
    expect(hub.routeEvent(mattEvent)).toBe(true);
    expect(matt.sent).toHaveLength(2);
    const mattRouted = JSON.parse(matt.sent[1]!);
    expect(mattRouted).toMatchObject({ type: 'event', message: mattEvent });
    expect(typeof mattRouted.eventId).toBe('string');
    expect(alice.sent).toHaveLength(1);

    const aliceEvent: SlackInboundMessage = {
      teamId: 'T1',
      channelId: 'D2',
      ts: '2.0',
      userId: 'Ualice',
      text: 'hi',
      kind: 'dm',
    };
    expect(hub.routeEvent(aliceEvent)).toBe(true);
    expect(alice.sent).toHaveLength(2);
    expect(matt.sent).toHaveLength(2);
  });

  it('fans out to Personal and Work; first claim wins', async () => {
    const personal = fakeSocket();
    const work = fakeSocket();
    const hub = new SlackRelayHub({
      authTest: async (token) =>
        token.startsWith('xoxp-')
          ? { ok: true, team_id: 'T1', user_id: 'Umatt' }
          : { ok: true, team_id: 'T1', user_id: 'Bbot' },
    });
    await hub.register(
      personal.socket,
      'T1',
      'Umatt',
      'personal-id',
      'Personal',
      'xoxb-bot',
      'xoxp-user',
    );
    await hub.register(
      work.socket,
      'T1',
      'Umatt',
      'work-id',
      'Work',
      'xoxb-bot',
      'xoxp-user',
    );

    const event: SlackInboundMessage = {
      teamId: 'T1',
      channelId: 'D1',
      ts: '3.0',
      userId: 'Umatt',
      text: 'which mac?',
      kind: 'dm',
    };
    expect(hub.routeEvent(event)).toBe(true);
    expect(personal.sent).toHaveLength(2);
    expect(work.sent).toHaveLength(2);
    const eventId = JSON.parse(personal.sent[1]!).eventId as string;
    expect(JSON.parse(work.sent[1]!).eventId).toBe(eventId);

    await hub.handleClientMessage(work.socket, { type: 'claim', eventId });
    expect(JSON.parse(work.sent[2]!)).toEqual({ type: 'claim_ok', eventId });

    await hub.handleClientMessage(personal.socket, { type: 'claim', eventId });
    expect(JSON.parse(personal.sent[2]!)).toEqual({ type: 'claim_denied', eventId });
  });

  it('routes Work: prefix only to the Work Mac', async () => {
    const personal = fakeSocket();
    const work = fakeSocket();
    const hub = new SlackRelayHub({
      authTest: async (token) =>
        token.startsWith('xoxp-')
          ? { ok: true, team_id: 'T1', user_id: 'Umatt' }
          : { ok: true, team_id: 'T1', user_id: 'Bbot' },
    });
    await hub.register(
      personal.socket,
      'T1',
      'Umatt',
      'personal-id',
      'Personal',
      'xoxb-bot',
      'xoxp-user',
    );
    await hub.register(
      work.socket,
      'T1',
      'Umatt',
      'work-id',
      'Work',
      'xoxb-bot',
      'xoxp-user',
    );

    expect(
      hub.routeEvent({
        teamId: 'T1',
        channelId: 'D1',
        ts: '4.0',
        userId: 'Umatt',
        text: 'Work: open the PR',
        kind: 'dm',
      }),
    ).toBe(true);
    expect(personal.sent).toHaveLength(1);
    expect(work.sent).toHaveLength(2);
    expect(JSON.parse(work.sent[1]!)).toMatchObject({
      type: 'event',
      message: { text: 'open the PR' },
    });
  });

  it('does not deliver when that Slack user has no desktop online', () => {
    const hub = new SlackRelayHub({
      authTest: async () => ({ ok: true, team_id: 'T1', user_id: 'Umatt' }),
    });
    expect(
      hub.routeEvent({
        teamId: 'T1',
        channelId: 'D1',
        ts: '1.0',
        userId: 'Ualice',
        text: 'hello',
        kind: 'dm',
      }),
    ).toBe(false);
  });

  it('skips events without a Slack user id', () => {
    const hub = new SlackRelayHub({
      authTest: async () => ({ ok: true, team_id: 'T1', user_id: 'Umatt' }),
    });
    expect(
      hub.routeEvent({
        teamId: 'T1',
        channelId: 'D1',
        ts: '1.0',
        text: 'hello',
        kind: 'dm',
      }),
    ).toBe(false);
  });
});
