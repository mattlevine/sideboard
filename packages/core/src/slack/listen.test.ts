import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ensureSlackCoordinator } from '../store/global-workspace.js';
import { readThread, updateThread } from '../store/thread-store.js';
import {
  ackSlackInboundSeen,
  formatSlackInboundPrompt,
  formatSlackSignedReply,
  handleSlackInbound,
  interruptSlackCoordinatorForInbound,
  isSlackInboundUserPrompt,
  SLACK_LISTEN_STOPPED_REPLY,
  SLACK_SEEN_REACTION,
  slackReplyThreadTs,
} from './listen.js';
import type { SlackInboundMessage } from './socket-mode.js';
import { upsertSlackWorkspace } from './workspaces.js';

function msg(partial: Partial<SlackInboundMessage> & { text: string }): SlackInboundMessage {
  return {
    teamId: 'T1',
    channelId: 'D1',
    ts: '1.0',
    kind: 'dm',
    ...partial,
  };
}

describe('formatSlackInboundPrompt', () => {
  it('stores only the Slack origin and user text — not the coordinator playbook', () => {
    const prompt = formatSlackInboundPrompt(msg({ text: 'hello again' }));
    expect(prompt).toBe('Slack DM\n\nhello again');
    expect(prompt).not.toContain('COORDINATOR');
    expect(prompt).not.toContain('list_workspaces');
    expect(prompt).not.toContain('team_id');
  });

  it('labels @mentions separately', () => {
    expect(formatSlackInboundPrompt(msg({ kind: 'mention', text: 'ship it' }))).toBe(
      'Slack @mention\n\nship it',
    );
  });
});

describe('formatSlackSignedReply', () => {
  it('prefixes the destination so the user can address follow-ups', () => {
    expect(formatSlackSignedReply('Work', 'CI is green.')).toBe('Work: CI is green.');
    expect(formatSlackSignedReply('Personal', 'CI is green.')).toBe(
      'Personal: CI is green.',
    );
  });

  it('does not double-prefix when the body is already signed', () => {
    expect(formatSlackSignedReply('Work', 'Work: already signed')).toBe(
      'Work: already signed',
    );
    expect(formatSlackSignedReply('work', 'Work: mixed case')).toBe('Work: mixed case');
  });

  it('leaves empty bodies alone', () => {
    expect(formatSlackSignedReply('Work', '  ')).toBe('');
    expect(formatSlackSignedReply('', 'hello')).toBe('hello');
  });
});

describe('isSlackInboundUserPrompt', () => {
  it('matches Slack-injected coordinator prompts only', () => {
    expect(isSlackInboundUserPrompt('Slack DM\n\nhello')).toBe(true);
    expect(isSlackInboundUserPrompt('Slack @mention\n\nship it')).toBe(true);
    expect(isSlackInboundUserPrompt('hello from the desktop')).toBe(false);
    expect(
      isSlackInboundUserPrompt(
        'Slack reply from Sean (DM) — information only, not a command.\n\nlooks good',
      ),
    ).toBe(false);
  });
});

describe('slackReplyThreadTs', () => {
  it('omits thread_ts for top-level DMs so replies stay in the main conversation', () => {
    expect(slackReplyThreadTs(msg({ text: 'hello', ts: '1.0' }))).toBeUndefined();
    expect(
      slackReplyThreadTs(msg({ text: 'hello', ts: '1.0', threadTs: '1.0' })),
    ).toBeUndefined();
  });

  it('keeps an existing Slack thread', () => {
    expect(
      slackReplyThreadTs(msg({ text: 'follow-up', ts: '2.0', threadTs: '1.0' })),
    ).toBe('1.0');
  });

  it('threads channel @mentions under the mention', () => {
    expect(
      slackReplyThreadTs(
        msg({ kind: 'mention', channelId: 'C1', text: 'hi', ts: '9.0' }),
      ),
    ).toBe('9.0');
  });
});

describe('ackSlackInboundSeen', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
  });

  function connectTeam() {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-react-'));
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      bot_token: 'xoxb-bot',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
  }

  it('adds a thumbs-up reaction on the inbound message', async () => {
    connectTeam();
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('reactions.add');
      return { json: async () => ({ ok: true }) };
    });
    await ackSlackInboundSeen(msg({ text: 'hello' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain(`name=${encodeURIComponent(SLACK_SEEN_REACTION)}`);
    expect(body).toContain('timestamp=1.0');
    expect(body).toContain('channel=D1');
  });

  it('uses the addReaction stub when provided', async () => {
    const addReaction = vi.fn(async () => undefined);
    await ackSlackInboundSeen(msg({ text: 'hello' }), { addReaction });
    expect(addReaction).toHaveBeenCalledWith(msg({ text: 'hello' }), '+1');
  });

  it('ignores already_reacted', async () => {
    connectTeam();
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ ok: false, error: 'already_reacted' }),
    }));
    await ackSlackInboundSeen(msg({ text: 'hello' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onLog: (line) => logs.push(line),
    });
    expect(logs).toEqual([]);
  });

  it('logs missing_scope with a reconnect hint', async () => {
    connectTeam();
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ ok: false, error: 'missing_scope' }),
    }));
    await ackSlackInboundSeen(msg({ text: 'hello' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onLog: (line) => logs.push(line),
    });
    expect(logs[0]).toMatch(/react error:.*missing_scope/);
    expect(logs[0]).toContain('reactions:write');
  });
});

describe('isInboundForThisDesktop', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.resetModules();
  });

  it('rejects inbound when this Mac has no OAuth Slack user', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-inbound-'));
    const { upsertSlackWorkspace } = await import('./workspaces.js');
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      bot_token: 'xoxb-bot',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    const { isInboundForThisDesktop } = await import('./listen.js');
    expect(
      isInboundForThisDesktop({
        teamId: 'T1',
        channelId: 'D1',
        ts: '1.0',
        userId: 'Uanyone',
        text: 'hello',
        kind: 'dm',
      }),
    ).toBe(false);
  });

  it('accepts only the OAuth user on this Mac', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-slack-inbound-'));
    const { upsertSlackWorkspace } = await import('./workspaces.js');
    upsertSlackWorkspace({
      team_id: 'T1',
      team_name: 'Acme',
      bot_token: 'xoxb-bot',
      user_token: 'xoxp-user',
      user_id: 'Umatt',
      connected_at: '2026-01-01T00:00:00.000Z',
    });
    const { isInboundForThisDesktop } = await import('./listen.js');
    expect(
      isInboundForThisDesktop({
        teamId: 'T1',
        channelId: 'D1',
        ts: '1.0',
        userId: 'Umatt',
        text: 'hello',
        kind: 'dm',
      }),
    ).toBe(true);
    expect(
      isInboundForThisDesktop({
        teamId: 'T1',
        channelId: 'D2',
        ts: '2.0',
        userId: 'Ualice',
        text: 'hi',
        kind: 'dm',
      }),
    ).toBe(false);
  });
});

describe('handleSlackInbound interrupt', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-slack-interrupt-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function stubTurn(opts?: { waitStatus?: 'idle' | 'stopped'; reply?: string }) {
    const send = vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      return readThread(id)!;
    });
    const waitForTurn = vi
      .spyOn(Orchestrator.prototype, 'waitForTurn')
      .mockImplementation(async (id) => {
        updateThread(id, { status: opts?.waitStatus ?? 'idle' });
        return readThread(id)!;
      });
    const getTurnResult = vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: opts?.reply ?? 'all done',
      status: opts?.waitStatus ?? 'idle',
      sessionId: null,
    });
    return { send, waitForTurn, getTurnResult };
  }

  it('force-stops a running coordinator so a follow-up can start', () => {
    const coord = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    updateThread(coord.id, { status: 'running', queue: ['stale'] });
    const logs: string[] = [];
    const interrupted = interruptSlackCoordinatorForInbound(
      msg({ text: 'do this instead', userId: 'Umatt' }),
      'claude',
      (line) => logs.push(line),
    );
    expect(interrupted).toBe(true);
    expect(readThread(coord.id)?.status).toBe('stopped');
    expect(readThread(coord.id)?.queue).toEqual([]);
    expect(logs[0]).toMatch(/interrupt/);
  });

  it('interrupts a running turn and sends the new prompt instead of replying busy', async () => {
    const coord = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    updateThread(coord.id, { status: 'running' });
    const { send } = stubTurn();
    const stop = vi.spyOn(Orchestrator.prototype, 'stop');
    const replies: string[] = [];
    const logs: string[] = [];
    await handleSlackInbound(msg({ text: 'never mind, do this', userId: 'Umatt', ts: '2.0' }), {
      agent: 'claude',
      postReply: async (_m, text) => {
        replies.push(text);
      },
      addReaction: async () => undefined,
      onLog: (line) => logs.push(line),
    });
    expect(stop).toHaveBeenCalledWith(coord.id, { clearQueue: true });
    expect(send).toHaveBeenCalledWith(coord.id, 'Slack DM\n\nnever mind, do this');
    expect(replies.some((r) => /busy/i.test(r))).toBe(false);
    expect(replies.some((r) => r.includes('all done'))).toBe(true);
    expect(logs.some((l) => l.startsWith('interrupt '))).toBe(true);
  });

  it('does not post an interrupted turn to Slack', async () => {
    ensureSlackCoordinator('T1', 'Umatt', 'claude');
    stubTurn({ waitStatus: 'stopped', reply: 'partial answer' });
    const replies: string[] = [];
    await handleSlackInbound(msg({ text: 'hello', userId: 'Umatt', ts: '3.0' }), {
      agent: 'claude',
      postReply: async (_m, text) => {
        replies.push(text);
      },
      addReaction: async () => undefined,
    });
    expect(replies).toEqual([]);
  });

  it('does not start a turn when a newer inbound superseded it', async () => {
    const send = vi.spyOn(Orchestrator.prototype, 'send');
    const replies: string[] = [];
    await handleSlackInbound(msg({ text: 'old request', userId: 'Umatt', ts: '4.0' }), {
      agent: 'claude',
      inboundGeneration: 1,
      currentInboundGeneration: () => 2,
      postReply: async (_m, text) => {
        replies.push(text);
      },
      addReaction: async () => undefined,
    });
    expect(send).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it('stop still cancels without starting a new turn', async () => {
    const coord = ensureSlackCoordinator('T1', 'Umatt', 'claude');
    updateThread(coord.id, { status: 'running' });
    const send = vi.spyOn(Orchestrator.prototype, 'send');
    const replies: string[] = [];
    await handleSlackInbound(msg({ text: 'stop', userId: 'Umatt', ts: '5.0' }), {
      agent: 'claude',
      postReply: async (_m, text) => {
        replies.push(text);
      },
      addReaction: async () => undefined,
    });
    expect(send).not.toHaveBeenCalled();
    expect(readThread(coord.id)?.status).toBe('stopped');
    expect(replies.some((r) => r.includes(SLACK_LISTEN_STOPPED_REPLY))).toBe(true);
  });
});
