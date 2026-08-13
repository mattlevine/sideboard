import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listSlackUsers,
  normalizeSlackHandle,
  resolveSlackDestination,
} from './destination.js';

type FetchCall = [string, RequestInit | undefined];

function jsonResponse(body: unknown) {
  return {
    json: async () => body,
  };
}

function methodFromUrl(url: string): string {
  return url.replace(/^.*\/api\//, '');
}

describe('normalizeSlackHandle', () => {
  it('strips # @ and Slack mention wrappers', () => {
    expect(normalizeSlackHandle('#eng')).toBe('eng');
    expect(normalizeSlackHandle('@matt')).toBe('matt');
    expect(normalizeSlackHandle('<@U123ABC>')).toBe('U123ABC');
    expect(normalizeSlackHandle('<#C99|eng>')).toBe('C99');
  });
});

describe('resolveSlackDestination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns channel ids as-is', async () => {
    const dest = await resolveSlackDestination('xoxb', 'C123');
    expect(dest).toEqual({ channelId: 'C123', kind: 'channel', label: 'C123' });
  });

  it('resolves #channel by name', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(methodFromUrl(url)).toBe('conversations.list');
      return jsonResponse({
        ok: true,
        channels: [{ id: 'Ceng', name: 'eng' }],
      });
    });
    const dest = await resolveSlackDestination('xoxb', '#eng', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(dest).toEqual({ channelId: 'Ceng', kind: 'channel', label: '#eng' });
  });

  it('opens a DM for @user', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const method = methodFromUrl(url);
      if (method === 'users.list') {
        return jsonResponse({
          ok: true,
          members: [
            {
              id: 'Umatt',
              name: 'matt',
              profile: { display_name: 'Matt', real_name: 'Matt L' },
            },
          ],
          response_metadata: { next_cursor: '' },
        });
      }
      if (method === 'conversations.open') {
        return jsonResponse({ ok: true, channel: { id: 'Ddm1' } });
      }
      throw new Error(`unexpected ${method}`);
    });
    const dest = await resolveSlackDestination('xoxb', '@matt', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(dest).toEqual({
      channelId: 'Ddm1',
      kind: 'user',
      userId: 'Umatt',
      label: 'Matt',
    });
    const openCall = (fetchImpl.mock.calls as FetchCall[]).find((c) =>
      methodFromUrl(c[0]).includes('conversations.open'),
    );
    expect(String(openCall?.[1]?.body)).toContain('users=Umatt');
  });

  it('opens a DM for a user id', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(methodFromUrl(url)).toBe('conversations.open');
      return jsonResponse({ ok: true, channel: { id: 'D9' } });
    });
    const dest = await resolveSlackDestination('xoxb', 'UABCDEF1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(dest.channelId).toBe('D9');
    expect(dest.kind).toBe('user');
    expect(dest.userId).toBe('UABCDEF1');
  });
});

describe('listSlackUsers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('filters bots and matches query', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: true,
        members: [
          { id: 'U1', name: 'alice', profile: { real_name: 'Alice' } },
          { id: 'U2', name: 'bob', is_bot: true },
          { id: 'U3', name: 'carol', deleted: true },
          {
            id: 'U4',
            name: 'dave',
            profile: { display_name: 'Dave', email: 'dave@acme.com' },
          },
        ],
        response_metadata: { next_cursor: '' },
      }),
    );
    const users = await listSlackUsers('xoxb', {
      query: 'dave',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(users).toEqual([
      {
        id: 'U4',
        name: 'dave',
        real_name: undefined,
        display_name: 'Dave',
        email: 'dave@acme.com',
      },
    ]);
  });
});
