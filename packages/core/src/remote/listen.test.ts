import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ensureRemoteCoordinator, findRemoteCoordinator } from '../store/global-workspace.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { handleRemoteInbound, REMOTE_STOPPED_REPLY } from './listen.js';
import { encodePhoneControl } from './phone-chats.js';

describe('handleRemoteInbound interrupt', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-remote-interrupt-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('stops a running phone turn before the handle queue', async () => {
    const thread = ensureRemoteCoordinator('phone-1', 'claude');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waits = 0;
    const send = vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => {
      waits += 1;
      if (waits === 1) await gate;
      else updateThread(String(id), { status: 'idle' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'all done',
      status: 'idle',
      taskState: 'completed',
      sessionId: null,
      lastError: null,
      stillRunning: false,
      progress: null,
      lastActivityAt: null,
      usage: null,
    });
    const stop = vi.spyOn(Orchestrator.prototype, 'stop').mockImplementation((id) => {
      release();
      updateThread(String(id), { status: 'stopped', queue: [] });
      return readThread(String(id))!;
    });
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };

    handleRemoteInbound('first', { deviceId: 'phone-1', agent: 'claude', onOutbound: outbound });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(stop).not.toHaveBeenCalled();

    handleRemoteInbound('second', { deviceId: 'phone-1', agent: 'claude', onOutbound: outbound });
    expect(stop).toHaveBeenCalledWith(thread.id, { clearQueue: true });

    await vi.waitFor(() => expect(replies).toEqual(['all done']));
    expect(send).toHaveBeenLastCalledWith(thread.id, 'Phone\n\nsecond');
  });

  it('replies to stop without waiting out the in-flight turn', async () => {
    ensureRemoteCoordinator('phone-2', 'claude');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => {
      await gate;
      return readThread(String(id))!;
    });
    const stop = vi.spyOn(Orchestrator.prototype, 'stop').mockImplementation((id) => {
      release();
      updateThread(String(id), { status: 'stopped', queue: [] });
      return readThread(String(id))!;
    });
    const replies: string[] = [];

    handleRemoteInbound('first', {
      deviceId: 'phone-2',
      agent: 'claude',
      onOutbound: () => undefined,
    });
    await vi.waitFor(() => expect(readThread(ensureRemoteCoordinator('phone-2', 'claude').id)?.status).toBe('running'));

    handleRemoteInbound('stop', {
      deviceId: 'phone-2',
      agent: 'claude',
      onOutbound: (msg) => {
        if (msg.type === 'assistant') replies.push(msg.text);
      },
    });
    expect(stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(replies).toEqual([REMOTE_STOPPED_REPLY]));
  });

  it('lists chats without stopping the in-flight coordinator', async () => {
    ensureRemoteCoordinator('phone-3', 'claude');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async () => {
      await gate;
      return readThread(ensureRemoteCoordinator('phone-3', 'claude').id)!;
    });
    const stop = vi.spyOn(Orchestrator.prototype, 'stop');
    const replies: string[] = [];

    handleRemoteInbound('first', {
      deviceId: 'phone-3',
      agent: 'claude',
      onOutbound: (msg) => {
        if (msg.type === 'assistant') replies.push(msg.text);
      },
    });
    await vi.waitFor(() => expect(readThread(ensureRemoteCoordinator('phone-3', 'claude').id)?.status).toBe('running'));

    handleRemoteInbound(encodePhoneControl({ op: 'list' }), {
      deviceId: 'phone-3',
      agent: 'claude',
      onOutbound: (msg) => {
        if (msg.type === 'assistant') replies.push(msg.text);
      },
    });

    expect(stop).not.toHaveBeenCalled();
    expect(replies[0]).toContain('"op":"sidebar"');
    release();
  });

  it('sends a prompt to the selected orchestration chat', async () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), {
      deviceId: 'phone-4',
      agent: 'claude',
      onOutbound: outbound,
    });
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as {
      op: string;
      chat: { id: string };
    };
    expect(opened.op).toBe('opened');

    const send = vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'idle' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => readThread(String(id))!);
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'shipped',
      status: 'idle',
      taskState: 'completed',
      sessionId: null,
      lastError: null,
      stillRunning: false,
      progress: null,
      lastActivityAt: null,
      usage: null,
    });

    handleRemoteInbound(encodePhoneControl({ op: 'prompt', chatId: opened.chat.id, text: 'ship it' }), {
      deviceId: 'phone-4',
      agent: 'claude',
      onOutbound: outbound,
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(opened.chat.id, 'Phone\n\nship it'));
    expect(findRemoteCoordinator('phone-4')).toBeUndefined();
    await vi.waitFor(() => expect(replies.some((line) => line.includes('"op":"assistant"'))).toBe(true));
  });

  it('lists archived chats and restores one onto the sidebar', async () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    const opts = { deviceId: 'phone-5', agent: 'claude' as const, onOutbound: outbound };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), opts);
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as { chat: { id: string } };
    handleRemoteInbound(encodePhoneControl({ op: 'archive', chatId: opened.chat.id }), opts);
    handleRemoteInbound(encodePhoneControl({ op: 'history' }), opts);
    const history = JSON.parse(replies.at(-1)!.slice(replies.at(-1)!.indexOf('{'))) as {
      op: string;
      chats: Array<{ id: string }>;
    };
    expect(history.op).toBe('history');
    expect(history.chats.map((chat) => chat.id)).toEqual([opened.chat.id]);

    vi.spyOn(Orchestrator.prototype, 'restore').mockImplementation(async (id) => {
      return updateThread(String(id), { status: 'idle' });
    });
    handleRemoteInbound(encodePhoneControl({ op: 'restore', chatId: opened.chat.id }), opts);
    await vi.waitFor(() =>
      expect(replies.some((line) => line.includes('"op":"restored"') && line.includes(opened.chat.id))).toBe(true),
    );
    expect(replies.some((line) => line.includes('"op":"sidebar"') && line.includes(opened.chat.id))).toBe(true);
    expect(readThread(opened.chat.id)?.status).toBe('idle');
  });

  it('sends a photo or file with the prompt without clearing other composer chips', async () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), {
      deviceId: 'phone-files',
      agent: 'claude',
      onOutbound: outbound,
    });
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as { chat: { id: string } };
    const send = vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'idle' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => readThread(String(id))!);
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'saw it',
      status: 'idle',
      taskState: 'completed',
      sessionId: null,
      lastError: null,
      stillRunning: false,
      progress: null,
      lastActivityAt: null,
      usage: null,
    });
    handleRemoteInbound(
      encodePhoneControl({
        op: 'prompt',
        chatId: opened.chat.id,
        text: 'what is this',
        files: [{ name: 'note.txt', dataBase64: Buffer.from('hello').toString('base64') }],
      }),
      { deviceId: 'phone-files', agent: 'claude', onOutbound: outbound },
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    const attachments = send.mock.calls[0]?.[2]?.attachments;
    expect(attachments?.[0]).toMatchObject({ name: 'note.txt', kind: 'file' });
    expect(attachments?.[0]?.path).toContain('.context/attachments/');
    expect(attachments?.[0]?.content).toContain('hello');
  });

  it('turns a phone recording into dictated text', async () => {
    const replies: string[] = [];
    handleRemoteInbound(
      encodePhoneControl({ op: 'dictate', id: 'mic-1', audioBase64: 'AAAA' }),
      {
        deviceId: 'phone-mic',
        agent: 'claude',
        onOutbound: (msg) => {
          if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
        },
        transcribeWav: async () => 'ship the fix',
      },
    );
    await vi.waitFor(() => expect(replies.some((line) => line.includes('ship the fix'))).toBe(true));
    const reply = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as { op: string; id: string; text: string };
    expect(reply).toEqual({ op: 'dictated', id: 'mic-1', text: 'ship the fix' });
  });
});
