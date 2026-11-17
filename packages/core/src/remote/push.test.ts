import { describe, expect, it, vi } from 'vitest';
import { RemoteHub, type RemoteSocket } from './hub.js';
import { parseRemoteClientMessage, type RemoteServerMessage } from './protocol.js';
import {
  expoPushMessage,
  hostedPushRelay,
  isExpoPushToken,
  pushNotes,
  sendExpoPushes,
} from './push.js';
import { startPhonePushWatch } from './phone-push-watch.js';
import type { OrchestratorEvent } from '../types/thread.js';

const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';

function fakeSocket(): RemoteSocket & { messages: RemoteServerMessage[] } {
  const messages: RemoteServerMessage[] = [];
  return {
    messages,
    send(data: string) {
      messages.push(JSON.parse(data) as RemoteServerMessage);
    },
    close() {},
  };
}

function last(socket: { messages: RemoteServerMessage[] }): RemoteServerMessage {
  const msg = socket.messages.at(-1);
  if (!msg) throw new Error('no message');
  return msg;
}

describe('push alerts', () => {
  it('keeps the alert to the Mac name and a fixed sentence', () => {
    const message = expoPushMessage({
      to: TOKEN,
      deviceLabel: 'Work',
      deviceId: 'mac-1',
      chatId: 'chat-1234',
      kind: 'needs_you',
    });
    expect(message.title).toBe('Work');
    expect(message.body).toBe('A chat needs you');
    expect(message.data).toEqual({ deviceId: 'mac-1', chatId: 'chat-1234', kind: 'needs_you' });
    expect(JSON.stringify(message)).not.toContain('the secret reply');
  });

  it('accepts an Expo token and only Sideboard’s relay', () => {
    expect(isExpoPushToken(TOKEN)).toBe(true);
    expect(isExpoPushToken('https://evil.example')).toBe(false);
    expect(hostedPushRelay('wss://relay.sideboard.build/remote')).toBe(true);
    expect(hostedPushRelay('ws://192.168.1.8:8787/remote')).toBe(false);
    expect(hostedPushRelay('wss://relay.example.com/remote')).toBe(false);
  });

  it('notifies a new needs-you once, and a clean finish separately', () => {
    const before = new Set<string>();
    const after = new Set(['chat-1234']);
    expect(pushNotes({ event: null, before, after })).toEqual([{ chatId: 'chat-1234', kind: 'needs_you' }]);
    expect(
      pushNotes({
        event: { type: 'turn_finished', threadId: 'chat-9999', exitCode: 0 },
        before: after,
        after,
      }),
    ).toEqual([{ chatId: 'chat-9999', kind: 'finished' }]);
    expect(
      pushNotes({
        event: { type: 'error', threadId: 'chat-9999', message: 'boom' },
        before: after,
        after,
      }),
    ).toEqual([{ chatId: 'chat-9999', kind: 'failed' }]);
  });

  it('stays quiet when the user stopped the turn, including to send the next message', () => {
    const ids = new Set(['chat-1234']);
    expect(
      pushNotes({
        event: { type: 'turn_finished', threadId: 'chat-9999', exitCode: 143, routineStop: true },
        before: ids,
        after: ids,
      }),
    ).toEqual([]);
    expect(
      pushNotes({
        event: { type: 'turn_finished', threadId: 'chat-9999', exitCode: 0, routineStop: true },
        before: ids,
        after: ids,
      }),
    ).toEqual([]);
  });

  it('does not repeat a needs-you that is already showing', () => {
    const ids = new Set(['chat-1234']);
    expect(pushNotes({ event: null, before: ids, after: ids })).toEqual([]);
  });

  it('posts the messages to Expo and surfaces a rejection', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const message = expoPushMessage({
      to: TOKEN,
      deviceLabel: 'Work',
      deviceId: 'mac-1',
      chatId: 'chat-1234',
      kind: 'finished',
    });
    await sendExpoPushes([message], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as { body?: string } | undefined)?.body));
    expect(body[0].body).toBe('A turn finished');
    const reject = vi.fn(async () => new Response(JSON.stringify({ data: [{ status: 'error', message: 'no' }] }), { status: 200 }));
    await expect(sendExpoPushes([message], reject as unknown as typeof fetch)).rejects.toThrow('no');
  });
});

describe('RemoteHub push', () => {
  function pair(): { hub: RemoteHub; mac: ReturnType<typeof fakeSocket>; phone: ReturnType<typeof fakeSocket>; token: string; sent: ReturnType<typeof expoPushMessage>[] } {
    const sent: ReturnType<typeof expoPushMessage>[] = [];
    const hub = new RemoteHub({ onPush: (messages) => sent.push(...messages) });
    const mac = fakeSocket();
    const phone = fakeSocket();
    hub.handleClientMessage(mac, JSON.stringify({ type: 'host_register', deviceId: 'mac-1', deviceLabel: 'Work', hostSecret: 'secret' }));
    hub.handleClientMessage(mac, JSON.stringify({ type: 'host_pair' }));
    const code = last(mac);
    if (code.type !== 'pairing_code') throw new Error('expected code');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: code.code }));
    const paired = last(phone);
    if (paired.type !== 'paired') throw new Error('expected paired');
    return { hub, mac, phone, token: paired.sessionToken, sent };
  }

  it('rejects a push register that is not an Expo token', () => {
    expect(parseRemoteClientMessage(JSON.stringify({ type: 'push_register', token: 'nope', sessionTokens: ['abc'] }))).toBeNull();
    expect(parseRemoteClientMessage(JSON.stringify({ type: 'push_notify', chatId: 'chat-1234', kind: 'needs_you' }))?.type).toBe('push_notify');
  });

  it('sends when the phone is gone and skips the phone that is connected', () => {
    const { hub, mac, phone, token, sent } = pair();
    hub.handleClientMessage(phone, JSON.stringify({ type: 'push_register', token: TOKEN, sessionTokens: [token] }));
    hub.handleClientMessage(mac, JSON.stringify({ type: 'push_notify', chatId: 'chat-1234', kind: 'needs_you' }));
    expect(sent).toEqual([]);
    hub.detachSocket(phone);
    hub.handleClientMessage(mac, JSON.stringify({ type: 'push_notify', chatId: 'chat-1234', kind: 'needs_you' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(TOKEN);
    expect(sent[0]?.body).toBe('A chat needs you');
    expect(sent[0]?.data.chatId).toBe('chat-1234');
  });
});

describe('startPhonePushWatch', () => {
  it('sends a finish only while the relay socket is open', () => {
    const notes: Array<{ chatId: string; kind: string }> = [];
    let listener: ((event: OrchestratorEvent) => void) | null = null;
    const needing = new Set<string>();
    const stop = startPhonePushWatch({
      enabled: () => true,
      send: (note) => notes.push(note),
      needsYou: () => [...needing],
      events: (fn) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      subscribe: () => () => undefined,
    });
    listener?.({ type: 'turn_finished', threadId: 'chat-9999', exitCode: 0 });
    expect(notes).toEqual([{ chatId: 'chat-9999', kind: 'finished' }]);
    listener?.({ type: 'turn_finished', threadId: 'chat-9999', exitCode: 143, routineStop: true });
    expect(notes).toEqual([{ chatId: 'chat-9999', kind: 'finished' }]);
    stop();
  });
});
