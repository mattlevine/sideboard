import { describe, expect, it } from 'vitest';
import { RemoteHub, type RemoteSocket } from './hub.js';
import type { RemoteServerMessage } from './protocol.js';

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

function register(
  hub: RemoteHub,
  socket: RemoteSocket,
  deviceId: string,
  deviceLabel: string,
  hostSecret = 'secret',
) {
  hub.handleClientMessage(
    socket,
    JSON.stringify({ type: 'host_register', deviceId, deviceLabel, hostSecret }),
  );
}

function pairingCode(hub: RemoteHub, mac: { messages: RemoteServerMessage[] } & RemoteSocket): string {
  hub.handleClientMessage(mac, JSON.stringify({ type: 'host_pair' }));
  const msg = last(mac);
  if (msg.type !== 'pairing_code') throw new Error('expected pairing code');
  return msg.code;
}

function pairedToken(phone: { messages: RemoteServerMessage[] }): string {
  const msg = last(phone);
  if (msg.type !== 'paired') throw new Error('expected paired');
  return msg.sessionToken;
}

describe('RemoteHub', () => {
  it('answers ping with pong', () => {
    const hub = new RemoteHub();
    const socket = fakeSocket();
    hub.handleClientMessage(socket, JSON.stringify({ type: 'ping' }));
    expect(last(socket)).toEqual({ type: 'pong' });
  });

  it('pairs a phone to a registered Mac and forwards a prompt', () => {
    const hub = new RemoteHub();
    const mac = fakeSocket();
    const phone = fakeSocket();
    register(hub, mac, 'mac-1', 'Work');
    expect(last(mac).type).toBe('registered');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: pairingCode(hub, mac) }));
    expect(last(phone).type).toBe('paired');
    expect(last(mac).type).toBe('phone_joined');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'prompt', text: 'check CI' }));
    expect(last(mac)).toEqual({ type: 'inbound', text: 'check CI' });
    hub.handleClientMessage(mac, JSON.stringify({ type: 'assistant', text: 'CI is red' }));
    expect(last(phone)).toEqual({ type: 'assistant', text: 'CI is red' });
  });

  it('rejects a wrong host secret and an unknown code', () => {
    const hub = new RemoteHub();
    const mac = fakeSocket();
    register(hub, mac, 'mac-1', 'Work');
    const other = fakeSocket();
    register(hub, other, 'mac-1', 'Work', 'nope');
    expect(last(other)).toEqual({ type: 'error', message: 'host secret rejected' });
    const phone = fakeSocket();
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: 'ZZZZZZ' }));
    expect(last(phone).type).toBe('error');
  });

  it('requires a signed-in account when an authorizer is set', () => {
    const hub = new RemoteHub({
      authorizeHost: ({ accountToken }) =>
        accountToken === 'token' ? { ok: true } : { ok: false, message: 'sign in required' },
    });
    const rejected = fakeSocket();
    register(hub, rejected, 'mac-1', 'Work');
    expect(last(rejected)).toEqual({ type: 'error', message: 'sign in required' });
    const mac = fakeSocket();
    hub.handleClientMessage(
      mac,
      JSON.stringify({
        type: 'host_register',
        deviceId: 'mac-1',
        deviceLabel: 'Work',
        hostSecret: 'secret',
        accountToken: 'token',
      }),
    );
    expect(last(mac).type).toBe('registered');
  });

  it('lets one phone pair with several Macs and talk only to the one it selects', () => {
    const hub = new RemoteHub();
    const work = fakeSocket();
    const personal = fakeSocket();
    const phone = fakeSocket();
    register(hub, work, 'mac-work', 'Work');
    register(hub, personal, 'mac-home', 'Personal');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: pairingCode(hub, work) }));
    const workToken = pairedToken(phone);
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: pairingCode(hub, personal) }));
    const homeToken = pairedToken(phone);
    expect(last(work)).toEqual({ type: 'phone_left' });
    expect(last(personal).type).toBe('phone_joined');

    hub.handleClientMessage(
      phone,
      JSON.stringify({ type: 'list_hosts', sessionTokens: [workToken, homeToken] }),
    );
    expect(last(phone)).toEqual({
      type: 'hosts',
      hosts: [
        { sessionToken: workToken, deviceId: 'mac-work', deviceLabel: 'Work', online: true },
        { sessionToken: homeToken, deviceId: 'mac-home', deviceLabel: 'Personal', online: true },
      ],
    });

    hub.handleClientMessage(phone, JSON.stringify({ type: 'prompt', text: 'home' }));
    expect(last(personal)).toEqual({ type: 'inbound', text: 'home' });
    expect(work.messages.some((msg) => msg.type === 'inbound')).toBe(false);

    hub.handleClientMessage(phone, JSON.stringify({ type: 'resume', sessionToken: workToken }));
    expect(last(personal)).toEqual({ type: 'phone_left' });
    expect(last(work).type).toBe('phone_joined');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'prompt', text: 'work' }));
    expect(last(work)).toEqual({ type: 'inbound', text: 'work' });
    expect(personal.messages.filter((msg) => msg.type === 'inbound')).toEqual([
      { type: 'inbound', text: 'home' },
    ]);
  });

  it('keeps a phone session across disconnect and a Mac reconnect', () => {
    const hub = new RemoteHub();
    const mac = fakeSocket();
    const phone = fakeSocket();
    register(hub, mac, 'mac-1', 'Work');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: pairingCode(hub, mac) }));
    const token = pairedToken(phone);

    hub.detachSocket(phone);
    expect(last(mac).type).toBe('phone_left');
    const phone2 = fakeSocket();
    hub.handleClientMessage(phone2, JSON.stringify({ type: 'resume', sessionToken: token }));
    expect(last(phone2).type).toBe('paired');

    hub.detachSocket(mac);
    expect(last(phone2).type).toBe('host_offline');
    hub.handleClientMessage(phone2, JSON.stringify({ type: 'list_hosts', sessionTokens: [token] }));
    expect(last(phone2)).toEqual({
      type: 'hosts',
      hosts: [{ sessionToken: token, deviceId: 'mac-1', deviceLabel: 'Work', online: false }],
    });

    const thief = fakeSocket();
    register(hub, thief, 'mac-1', 'Work', 'other-secret');
    expect(last(thief)).toEqual({ type: 'error', message: 'host secret rejected' });

    const mac2 = fakeSocket();
    register(hub, mac2, 'mac-1', 'Office');
    hub.handleClientMessage(phone2, JSON.stringify({ type: 'list_hosts', sessionTokens: [token, 'missing'] }));
    expect(last(phone2)).toEqual({
      type: 'hosts',
      hosts: [
        { sessionToken: token, deviceId: 'mac-1', deviceLabel: 'Office', online: true },
        { sessionToken: 'missing', deviceId: '', deviceLabel: '', online: false },
      ],
    });
    hub.handleClientMessage(phone2, JSON.stringify({ type: 'resume', sessionToken: token }));
    hub.handleClientMessage(phone2, JSON.stringify({ type: 'prompt', text: 'back' }));
    expect(last(mac2)).toEqual({ type: 'inbound', text: 'back' });
  });

  it('renames a Mac on the same socket without dropping the phone', () => {
    const hub = new RemoteHub();
    const mac = fakeSocket();
    const phone = fakeSocket();
    register(hub, mac, 'mac-1', 'Work');
    hub.handleClientMessage(phone, JSON.stringify({ type: 'pair', code: pairingCode(hub, mac) }));
    const token = pairedToken(phone);
    register(hub, mac, 'mac-1', 'Office');
    expect(last(mac).type).toBe('phone_joined');
    expect(mac.messages.filter((msg) => msg.type === 'phone_left')).toEqual([]);
    expect(phone.messages.filter((msg) => msg.type === 'host_offline')).toEqual([]);
    hub.handleClientMessage(phone, JSON.stringify({ type: 'list_hosts', sessionTokens: [token] }));
    expect(last(phone)).toEqual({
      type: 'hosts',
      hosts: [{ sessionToken: token, deviceId: 'mac-1', deviceLabel: 'Office', online: true }],
    });
    hub.handleClientMessage(phone, JSON.stringify({ type: 'prompt', text: 'still paired' }));
    expect(last(mac)).toEqual({ type: 'inbound', text: 'still paired' });
  });

  it('drops the previous phone session when a different phone pairs to that Mac', () => {
    const hub = new RemoteHub();
    const mac = fakeSocket();
    const first = fakeSocket();
    const second = fakeSocket();
    register(hub, mac, 'mac-1', 'Work');
    hub.handleClientMessage(first, JSON.stringify({ type: 'pair', code: pairingCode(hub, mac) }));
    const firstToken = pairedToken(first);
    hub.handleClientMessage(second, JSON.stringify({ type: 'pair', code: pairingCode(hub, mac) }));
    hub.handleClientMessage(first, JSON.stringify({ type: 'list_hosts', sessionTokens: [firstToken] }));
    expect(last(first)).toEqual({
      type: 'hosts',
      hosts: [{ sessionToken: firstToken, deviceId: '', deviceLabel: '', online: false }],
    });
    hub.handleClientMessage(first, JSON.stringify({ type: 'resume', sessionToken: firstToken }));
    expect(last(first)).toEqual({ type: 'error', message: 'phone session expired — pair again' });
    hub.handleClientMessage(second, JSON.stringify({ type: 'prompt', text: 'still here' }));
    expect(last(mac)).toEqual({ type: 'inbound', text: 'still here' });
  });
});
