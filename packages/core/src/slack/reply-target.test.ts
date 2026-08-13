import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('slack reply target', () => {
  const prev = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prev === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prev;
    vi.resetModules();
  });

  it('round-trips the last Slack thread for a coordinator', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-reply-'));
    process.env.SIDEBOARD_SECRET_VAULT = 'plain';
    const mod = await import('./reply-target.js');
    expect(mod.getSlackReplyTarget('thread-1')).toBeNull();
    mod.setSlackReplyTarget({
      threadId: 'thread-1',
      teamId: 'T1',
      channelId: 'D1',
      threadTs: '12.34',
    });
    expect(mod.getSlackReplyTarget('thread-1')).toEqual({
      threadId: 'thread-1',
      teamId: 'T1',
      channelId: 'D1',
      threadTs: '12.34',
    });
    mod.setSlackReplyTarget({
      threadId: 'thread-1',
      teamId: 'T1',
      channelId: 'D1',
    });
    expect(mod.getSlackReplyTarget('thread-1')?.threadTs).toBeUndefined();
  });
});
