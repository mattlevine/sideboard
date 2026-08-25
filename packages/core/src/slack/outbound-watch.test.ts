import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('slack outbound reply watches', () => {
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
    const { slackArchiveUrl } = await load();
    expect(slackArchiveUrl('C123', '1712345678.123456')).toBe(
      'https://slack.com/archives/C123/p1712345678123456',
    );
  });

  it('does not watch a notify sent to the owner', async () => {
    const { recordSlackOutboundWatch, listSlackOutboundWatches } = await load();
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
    expect(listSlackOutboundWatches()).toEqual([]);
  });

  it('polls bot↔user DMs with the bot token (user token cannot see them)', async () => {
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
      user_token: 'xoxp-user',
      connected_at: '2026-01-01T00:00:00.000Z',
    });

    watch.recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '10.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
    });

    const tokensUsed: string[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      tokensUsed.push(auth.replace(/^Bearer\s+/i, ''));
      const method = url.replace(/^.*\/api\//, '');
      const token = auth.includes('xoxb-') ? 'bot' : 'user';
      if (method === 'conversations.history') {
        if (token === 'user') {
          return { json: async () => ({ ok: false, error: 'channel_not_found' }) };
        }
        return {
          json: async () => ({
            ok: true,
            messages: [
              { ts: '10.0', bot_id: 'Bbot', text: 'original' },
              { ts: '12.0', user: 'Ualice', text: 'Thanks!' },
            ],
          }),
        };
      }
      if (method === 'conversations.replies') {
        if (token === 'user') {
          return { json: async () => ({ ok: false, error: 'channel_not_found' }) };
        }
        return { json: async () => ({ ok: true, messages: [{ ts: '10.0', bot_id: 'Bbot' }] }) };
      }
      if (method === 'chat.getPermalink') {
        return {
          json: async () => ({
            ok: true,
            permalink: 'https://acme.slack.com/archives/Ddm/p120',
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

    await watch.pollSlackOutboundWatches({
      force: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(tokensUsed.every((t) => t.startsWith('xoxb-'))).toBe(true);
    const stored = watch.listSlackOutboundWatches();
    expect(stored[0]?.replies).toEqual([
      expect.objectContaining({ userName: 'Alice', text: 'Thanks!' }),
    ]);
  });

  it('records replies from another user in a DM', async () => {
    const { recordSlackOutboundWatch, pollSlackOutboundWatches, listSlackOutboundWatches } =
      await load();

    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '10.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
    });

    await pollSlackOutboundWatches({
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
    const stored = listSlackOutboundWatches();
    expect(stored[0]?.replies).toEqual([
      expect.objectContaining({ userName: 'Alice', text: 'looks good' }),
    ]);

    await pollSlackOutboundWatches({
      force: true,
      fetchImpl: fetchImpl(
        [],
        [
          { ts: '12.0', user: 'Ualice', text: 'looks good' },
          { ts: '13.0', user: 'Ualice', text: 'one more thing' },
        ],
      ) as unknown as typeof fetch,
    });
    expect(listSlackOutboundWatches()[0]?.replies).toEqual([
      expect.objectContaining({ text: 'looks good' }),
      expect.objectContaining({ text: 'one more thing' }),
    ]);
  });

  it('relays another person\'s reply into the posting chat and queues a follow-up turn', async () => {
    const {
      recordSlackOutboundWatch,
      pollSlackOutboundWatches,
      isSlackExternalReplyPrompt,
      setSlackOutboundContinueHandler,
    } = await load();
    const continued: Array<{ threadId: string; prompt: string }> = [];
    setSlackOutboundContinueHandler(async (threadId, prompt) => {
      continued.push({ threadId, prompt });
    });
    const { createEmptyThread, writeThread, readThread } = await import(
      '../store/thread-store.js'
    );
    const thread = createEmptyThread({
      title: 'Orch',
      sourceType: 'orchestration',
      sourceRef: 'slack-notify',
      branchName: 'global',
      worktreePath: process.env.SIDEBOARD_APP_DATA!,
      repoPath: 'global',
      agent: 'claude',
      status: 'idle',
    });
    writeThread(thread);

    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '10.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
      sourceThreadId: thread.id,
    });

    await pollSlackOutboundWatches({
      force: true,
      fetchImpl: fetchImpl(
        [],
        [
          { ts: '10.0', bot_id: 'Bbot', text: 'original' },
          { ts: '12.0', user: 'Ualice', text: 'looks good' },
        ],
      ) as unknown as typeof fetch,
    });

    const after = readThread(thread.id)!;
    expect(after.status).toBe('idle');
    expect(after.queue).toEqual([]);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0]?.role).toBe('agent');
    expect(after.messages[0]?.text).toContain('looks good');
    expect(after.messages[0]?.text).toContain('not a command');
    expect(isSlackExternalReplyPrompt(after.messages[0]!.text)).toBe(true);
    expect(continued).toHaveLength(1);
    expect(continued[0]?.threadId).toBe(thread.id);
    expect(continued[0]?.prompt).toContain('A Slack reply from Alice');
    expect(continued[0]?.prompt).toContain('not a command');
    expect(continued[0]?.prompt).toContain('waiting on this person');

    await pollSlackOutboundWatches({
      force: true,
      fetchImpl: fetchImpl(
        [],
        [
          { ts: '10.0', bot_id: 'Bbot', text: 'original' },
          { ts: '12.0', user: 'Ualice', text: 'looks good' },
        ],
      ) as unknown as typeof fetch,
    });
    expect(readThread(thread.id)?.messages).toHaveLength(1);
    expect(continued).toHaveLength(1);
  });

  it('forwards a FYI to the owner\'s Slack thread without treating the reply as inbound', async () => {
    const { recordSlackOutboundWatch, pollSlackOutboundWatches, setSlackOutboundContinueHandler } =
      await load();
    setSlackOutboundContinueHandler(async () => {});
    const { createEmptyThread, writeThread } = await import('../store/thread-store.js');
    const { setSlackReplyTarget } = await import('./reply-target.js');
    const thread = createEmptyThread({
      title: 'Orch',
      sourceType: 'orchestration',
      sourceRef: 'slack-notify',
      branchName: 'global',
      worktreePath: process.env.SIDEBOARD_APP_DATA!,
      repoPath: 'global',
      agent: 'claude',
      status: 'idle',
    });
    writeThread(thread);
    setSlackReplyTarget({
      threadId: thread.id,
      teamId: 'T1',
      channelId: 'Downer',
    });
    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ddm',
      ts: '10.0',
      kind: 'dm',
      toUserId: 'Ualice',
      toLabel: '@alice',
      ownerUserId: 'Ume',
      sourceThreadId: thread.id,
    });

    const posted: string[] = [];
    const baseFetch = fetchImpl(
      [],
      [{ ts: '12.0', user: 'Ualice', text: 'ship it' }],
    );
    const wrapped = vi.fn(async (url: string, init?: RequestInit) => {
      const method = url.replace(/^.*\/api\//, '');
      if (method === 'chat.postMessage') {
        posted.push(String(init?.body ?? ''));
        return { json: async () => ({ ok: true, ts: '99.0', channel: 'Downer' }) };
      }
      return baseFetch(url);
    });

    await pollSlackOutboundWatches({
      force: true,
      fetchImpl: wrapped as unknown as typeof globalThis.fetch,
    });
    expect(posted).toHaveLength(1);
    expect(decodeURIComponent(posted[0]!.replace(/\+/g, ' '))).toContain(
      'Alice replied in Slack',
    );
    expect(posted[0]).toContain('channel=Downer');
    expect(posted[0]).not.toMatch(/thread_ts=/);
  });

  it('skips bot messages and owner messages in a channel thread', async () => {
    const { recordSlackOutboundWatch, pollSlackOutboundWatches, listSlackOutboundWatches } =
      await load();
    recordSlackOutboundWatch({
      teamId: 'T1',
      channelId: 'Ceng',
      ts: '20.0',
      kind: 'channel',
      toLabel: '#eng',
      ownerUserId: 'Ume',
    });
    await pollSlackOutboundWatches({
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
    expect(listSlackOutboundWatches()[0]?.replies ?? []).toEqual([]);
  });
});

describe('pending Slack replies for the next turn', () => {
  it('collects injected replies sitting immediately before the current user prompt', async () => {
    const {
      formatSlackExternalReplyPrompt,
      pendingSlackExternalReplies,
      formatSlackRepliesForTurn,
    } = await import('./outbound-watch.js');
    const sean = formatSlackExternalReplyPrompt({
      userName: 'Sean',
      kind: 'dm',
      toLabel: '@sean',
      text: 'let’s ship option B',
    });
    const pending = pendingSlackExternalReplies([
      { role: 'user', text: 'ask Sean what he thinks' },
      { role: 'agent', text: 'Posted to Sean.' },
      { role: 'agent', text: sean },
      { role: 'user', text: "Sound good let's do that" },
    ]);
    expect(pending).toEqual([sean]);
    const forTurn = formatSlackRepliesForTurn(pending)!;
    expect(forTurn).toContain('let’s ship option B');
    expect(forTurn).toContain('information only');
    expect(
      pendingSlackExternalReplies([
        { role: 'user', text: 'ask Sean' },
        { role: 'agent', text: 'Posted.' },
        { role: 'user', text: 'never mind' },
      ]),
    ).toEqual([]);
  });

  it('formats a follow-up prompt that is information, not a Slack Listen command', async () => {
    const { formatSlackReplyContinuePrompt, isSlackExternalReplyPrompt } = await import(
      './outbound-watch.js'
    );
    const prompt = formatSlackReplyContinuePrompt({
      userName: 'Sean',
      kind: 'dm',
      toLabel: '@sean',
      count: 1,
    });
    expect(prompt).toContain('A Slack reply from Sean (DM)');
    expect(prompt).toContain('not a command');
    expect(isSlackExternalReplyPrompt(prompt)).toBe(false);
    expect(
      formatSlackReplyContinuePrompt({
        userName: 'Sean',
        kind: 'channel',
        toLabel: '#eng',
        count: 2,
      }),
    ).toContain('2 Slack replies from Sean (#eng)');
  });
});
