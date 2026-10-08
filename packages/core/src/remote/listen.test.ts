import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import * as desktopHost from '../store/desktop-host.js';
import { ensureRemoteCoordinator, findRemoteCoordinator } from '../store/global-workspace.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { handleRemoteInbound, REMOTE_STOPPED_REPLY } from './listen.js';
import { encodePhoneControl } from './phone-chats.js';
import { getPhoneOpenChat, setPhoneOpenChat } from './phone-live.js';

describe('handleRemoteInbound interrupt', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-remote-interrupt-'));
    vi.stubEnv('SIDEBOARD_APP_DATA', dataDir);
  });

  afterEach(() => {
    setPhoneOpenChat(null);
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

  it('stops treating a chat as open when the phone returns to the list', () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), {
      deviceId: 'phone-list',
      agent: 'claude',
      onOutbound: outbound,
    });
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as { chat: { id: string } };
    expect(getPhoneOpenChat()).toBe(opened.chat.id);

    handleRemoteInbound(encodePhoneControl({ op: 'list' }), {
      deviceId: 'phone-list',
      agent: 'claude',
      onOutbound: outbound,
    });
    expect(getPhoneOpenChat()).toBeNull();
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

    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(opened.chat.id, 'Phone\n\nship it', { attachments: [] }),
    );
    expect(findRemoteCoordinator('phone-4')).toBeUndefined();
    await vi.waitFor(() => expect(replies.some((line) => line.includes('"op":"assistant"'))).toBe(true));
  });

  it('streams markdown while a phone turn is running', async () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), {
      deviceId: 'phone-stream',
      agent: 'claude',
      onOutbound: outbound,
    });
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as {
      op: string;
      chat: { id: string };
    };
    expect(opened.op).toBe('opened');

    vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'on').mockImplementation((listener) => {
      listener({
        type: 'turn_output',
        threadId: opened.chat.id,
        event: { type: 'stdout', data: 'See [Board](sideboard://chat/abc)' },
      });
      return () => undefined;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            updateThread(opened.chat.id, { status: 'idle' });
            resolve(readThread(opened.chat.id)!);
          }, 40);
        }),
    );
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'See [Board](sideboard://chat/abc)',
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
      encodePhoneControl({ op: 'prompt', chatId: opened.chat.id, text: 'ship it' }),
      { deviceId: 'phone-stream', agent: 'claude', onOutbound: outbound },
    );

    await vi.waitFor(() => expect(replies.some((line) => line.includes('"op":"stream"'))).toBe(true));
    expect(replies.find((line) => line.includes('"op":"stream"'))).toContain('sideboard://chat/abc');
    await vi.waitFor(() => expect(replies.some((line) => line.includes('"op":"assistant"'))).toBe(true));
    const streamAt = replies.findIndex((line) => line.includes('"op":"stream"'));
    const assistantAt = replies.findIndex((line) => line.includes('"op":"assistant"'));
    expect(assistantAt).toBeGreaterThan(streamAt);
  });

  it('keeps streaming when a running phone chat is opened again', async () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), {
      deviceId: 'phone-reopen',
      agent: 'claude',
      onOutbound: outbound,
    });
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as { chat: { id: string } };
    let emit: ((event: unknown) => void) | null = null;
    vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'running' });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'on').mockImplementation((listener) => {
      emit = listener as (event: unknown) => void;
      return () => undefined;
    });
    let release: () => void = () => undefined;
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            updateThread(opened.chat.id, { status: 'idle' });
            resolve(readThread(opened.chat.id)!);
          };
        }),
    );
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'done',
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
      encodePhoneControl({ op: 'prompt', chatId: opened.chat.id, text: 'ship it' }),
      { deviceId: 'phone-reopen', agent: 'claude', onOutbound: outbound },
    );
    await vi.waitFor(() => expect(emit).toBeTruthy());
    emit?.({
      type: 'turn_output',
      threadId: opened.chat.id,
      event: { type: 'stdout', data: 'hello' },
    });
    await vi.waitFor(() => expect(replies.some((line) => line.includes('"op":"stream"'))).toBe(true));

    updateThread(opened.chat.id, { status: 'running' });
    handleRemoteInbound(encodePhoneControl({ op: 'open', chatId: opened.chat.id }), {
      deviceId: 'phone-reopen',
      agent: 'claude',
      onOutbound: outbound,
    });
    emit?.({
      type: 'turn_output',
      threadId: opened.chat.id,
      event: { type: 'stdout', data: ' more' },
    });
    await vi.waitFor(() => expect(replies.some((line) => line.includes('more'))).toBe(true));
    expect(replies.some((line) => line.includes('"op":"assistant"'))).toBe(false);

    release();
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

  it('replies on the phone after creating an orchestration', async () => {
    const replies: string[] = [];
    vi.spyOn(Orchestrator.prototype, 'send').mockImplementation(async (id, prompt) => {
      const current = readThread(String(id));
      updateThread(String(id), {
        status: 'queued',
        queue: [...(current?.queue ?? []), String(prompt)],
      });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => {
      updateThread(String(id), { status: 'idle', queue: [] });
      return readThread(String(id))!;
    });
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'orchestration ready',
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
      encodePhoneControl({ op: 'create', where: 'orchestration', goal: 'ship the fix' }),
      {
        deviceId: 'phone-create',
        agent: 'claude',
        onOutbound: (msg) => {
          if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
        },
      },
    );
    await vi.waitFor(() => expect(replies.some((line) => line.includes('"op":"opened"'))).toBe(true));
    await vi.waitFor(() => expect(replies.some((line) => line.includes('orchestration ready'))).toBe(true));
    const openedAt = replies.findIndex((line) => line.includes('"op":"opened"'));
    const replyAt = replies.findIndex((line) => line.includes('orchestration ready'));
    expect(replyAt).toBeGreaterThan(openedAt);
  });

  it('leaves desktop composer chips in place on a text-only phone send', async () => {
    const replies: string[] = [];
    const outbound = (msg: { type: string; text?: string }) => {
      if (msg.type === 'assistant' && msg.text) replies.push(msg.text);
    };
    handleRemoteInbound(encodePhoneControl({ op: 'create', where: 'orchestration' }), {
      deviceId: 'phone-chips',
      agent: 'claude',
      onOutbound: outbound,
    });
    const opened = JSON.parse(replies[0]!.slice(replies[0]!.indexOf('{'))) as { chat: { id: string } };
    updateThread(opened.chat.id, {
      attachments: [{ id: 'chip-1', name: 'shot.png', kind: 'file', content: 'Image attached: shot.png' }],
    });
    vi.spyOn(desktopHost, 'thisProcessShouldDrainAgentQueues').mockReturnValue(false);
    vi.spyOn(Orchestrator.prototype, 'waitForTurn').mockImplementation(async (id) => readThread(String(id))!);
    vi.spyOn(Orchestrator.prototype, 'getTurnResult').mockReturnValue({
      text: 'kept',
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
      deviceId: 'phone-chips',
      agent: 'claude',
      onOutbound: outbound,
    });
    await vi.waitFor(() => expect(readThread(opened.chat.id)?.queue.at(-1)).toBe('Phone\n\nship it'));
    expect(readThread(opened.chat.id)?.attachments).toEqual([
      expect.objectContaining({ id: 'chip-1', name: 'shot.png' }),
    ]);
  });
});
