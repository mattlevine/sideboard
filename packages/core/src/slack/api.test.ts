import { describe, expect, it, vi } from 'vitest';
import { slackApi, SlackApiError } from './api.js';

describe('slackApi', () => {
  it('uses the injected fetch implementation', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toContain(
        'xoxb-bot',
      );
      return {
        json: async () => ({ ok: true, ts: '1.2' }),
      };
    });
    const result = await slackApi<{ ts?: string }>(
      'xoxb-bot',
      'chat.postMessage',
      { channel: 'D1', text: 'hi', thread_ts: undefined },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ts).toBe('1.2');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain('channel=D1');
    expect(body).not.toContain('thread_ts');
  });

  it('throws SlackApiError when Slack returns ok:false', async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ ok: false, error: 'missing_scope' }),
    }));
    await expect(
      slackApi('xoxb-bot', 'chat.postMessage', { channel: 'D1', text: 'hi' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'SlackApiError', slackError: 'missing_scope' } satisfies Partial<SlackApiError>);
  });
});
