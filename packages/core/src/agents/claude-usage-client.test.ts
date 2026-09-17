import { afterEach, describe, expect, it } from 'vitest';
import { setHttpFetchImpl } from '../http/fetch.js';
import {
  accessTokenFromCredentialsJson,
  CLAUDE_OAUTH_USAGE_URL,
  CLAUDE_USAGE_ERROR_TTL_MS,
  CLAUDE_USAGE_STALE_OK_MS,
  CLAUDE_USAGE_TTL_MS,
  getClaudePlanUsage,
  resetClaudeUsageCacheForTests,
} from './claude-usage-client.js';

afterEach(() => {
  resetClaudeUsageCacheForTests();
  setHttpFetchImpl(null);
});

describe('accessTokenFromCredentialsJson', () => {
  it('reads claudeAiOauth.accessToken', () => {
    expect(
      accessTokenFromCredentialsJson(
        JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-test' } }),
      ),
    ).toBe('sk-ant-oat01-test');
  });

  it('reads a bare token line', () => {
    expect(accessTokenFromCredentialsJson('sk-ant-oat01-bare\n')).toBe('sk-ant-oat01-bare');
  });

  it('returns null for API-key-only JSON', () => {
    expect(accessTokenFromCredentialsJson(JSON.stringify({ apiKey: 'sk-ant-api' }))).toBeNull();
  });
});

describe('getClaudePlanUsage', () => {
  it('returns null without a token and does not fetch', async () => {
    let called = 0;
    const usage = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => null,
      fetch: async () => {
        called += 1;
        throw new Error('should not fetch');
      },
    });
    expect(usage).toBeNull();
    expect(called).toBe(0);
  });

  it('parses plan windows and caches the result', async () => {
    let called = 0;
    const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
      called += 1;
      expect(url).toBe(CLAUDE_OAUTH_USAGE_URL);
      expect(init?.headers?.Authorization).toBe('Bearer sk-ant-oat01-test');
      expect(init?.headers?.['User-Agent']).toMatch(/^claude-code\//);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 25, resets_at: '2026-04-08T18:00:00Z' },
          seven_day: { utilization: 40, resets_at: '2026-04-14T16:00:00Z' },
        }),
      };
    };
    const first = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    const second = await getClaudePlanUsage({
      now: 1_000 + CLAUDE_USAGE_TTL_MS - 1,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    expect(first?.windows).toHaveLength(2);
    expect(first?.windows[0]?.remainingPercent).toBe(75);
    expect(second).toBe(first);
    expect(called).toBe(1);
  });

  it('returns null on 401 (API key / expired login) without inventing numbers', async () => {
    const usage = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { type: 'authentication_error' } }),
      }),
    });
    expect(usage).toBeNull();
  });

  it('keeps the last good snapshot after a transient failure', async () => {
    let status = 200;
    const fetch = async () => ({
      ok: status === 200,
      status,
      json: async () => ({
        five_hour: { utilization: 10, resets_at: '2026-04-08T18:00:00Z' },
      }),
    });
    const first = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    status = 429;
    const second = await getClaudePlanUsage({
      now: 1_000 + CLAUDE_USAGE_TTL_MS + 1,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    expect(first?.windows[0]?.usedPercent).toBe(10);
    expect(second).toEqual(first);
  });

  it('reuses last on 429 even after the stale window, and does not refetch while backing off', async () => {
    let called = 0;
    let status = 200;
    const fetch = async () => {
      called += 1;
      return {
        ok: status === 200,
        status,
        json: async () => ({
          five_hour: { utilization: 10, resets_at: '2026-04-08T18:00:00Z' },
        }),
      };
    };
    const first = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    status = 429;
    const afterStale = await getClaudePlanUsage({
      now: 1_000 + CLAUDE_USAGE_STALE_OK_MS + CLAUDE_USAGE_TTL_MS + 1,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    const forced = await getClaudePlanUsage({
      now: 1_000 + CLAUDE_USAGE_STALE_OK_MS + CLAUDE_USAGE_TTL_MS + 2,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
      force: true,
    });
    const stillBackingOff = await getClaudePlanUsage({
      now: 1_000 + CLAUDE_USAGE_STALE_OK_MS + CLAUDE_USAGE_TTL_MS + CLAUDE_USAGE_ERROR_TTL_MS - 1,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
      force: true,
    });
    expect(first?.windows[0]?.usedPercent).toBe(10);
    expect(afterStale).toEqual(first);
    expect(forced).toEqual(first);
    expect(stillBackingOff).toEqual(first);
    expect(called).toBe(2);
  });

  it('uses injected httpFetch when no fetch opt is passed', async () => {
    let called = 0;
    setHttpFetchImpl(async () => {
      called += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 7, resets_at: '2026-04-08T18:00:00Z' },
        }),
      } as Response;
    });
    const usage = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
    });
    expect(usage?.windows[0]?.usedPercent).toBe(7);
    expect(called).toBe(1);
  });

  it('force skips a fresh cache', async () => {
    let called = 0;
    const fetch = async () => {
      called += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: called === 1 ? 10 : 100 },
        }),
      };
    };
    const first = await getClaudePlanUsage({
      now: 1_000,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
    });
    const second = await getClaudePlanUsage({
      now: 1_001,
      readAccessToken: async () => 'sk-ant-oat01-test',
      userAgent: 'claude-code/2.1.80',
      fetch,
      force: true,
    });
    expect(first?.windows[0]?.usedPercent).toBe(10);
    expect(second?.windows[0]?.usedPercent).toBe(100);
    expect(called).toBe(2);
  });
});
