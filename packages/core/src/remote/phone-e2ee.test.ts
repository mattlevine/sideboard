import { describe, expect, it } from 'vitest';
import {
  formatPairingBlob,
  generateHostSecretKey,
  generatePhoneToken,
  HostChannel,
  hostPublicKey,
  parsePairingBlob,
  PhoneChannel,
  type SealMaterial,
} from './phone-e2ee.js';

function pair(token = generatePhoneToken()) {
  const secret = generateHostSecretKey();
  const material: SealMaterial = { hostPublicKey: hostPublicKey(secret), phoneToken: token };
  const phone = new PhoneChannel(() => material);
  const host = new HostChannel(secret, (got) => got === token);
  return { secret, material, phone, host, token };
}

function handshake(token?: string) {
  const ctx = pair(token);
  const started = ctx.phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'mac' }));
  const hello = started.send[0] as { type: string; v: number; clientPublicKey: string; clientNonce: string };
  const ready = ctx.host.readyFor({
    v: 1,
    clientPublicKey: hello.clientPublicKey,
    clientNonce: hello.clientNonce,
  });
  if (!ready) throw new Error('ready');
  const accepted = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
  const auth = accepted.send[0] as { type: string; frame: string };
  const opened = ctx.host.openFrame(auth.frame);
  if (!opened?.okFrame) throw new Error('auth');
  const ok = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee', frame: opened.okFrame }));
  return { ...ctx, hello, ready, auth, ok };
}

describe('phone session encryption', () => {
  it('puts the Mac public key and phone token in the pairing line, not on the relay', () => {
    const secret = generateHostSecretKey();
    const token = generatePhoneToken();
    const blob = formatPairingBlob('AB234C', hostPublicKey(secret), token);
    expect(parsePairingBlob(blob)).toEqual({
      code: 'AB234C',
      hostPublicKey: hostPublicKey(secret),
      phoneToken: token,
    });
    expect(blob.startsWith('sb1.AB234C.')).toBe(true);
    expect(parsePairingBlob('not a line')).toBeNull();
  });

  it('encrypts prompts after the handshake and drops a replay', () => {
    const ctx = handshake();
    expect(ctx.ok.send).toEqual([]);
    const prompt = ctx.phone.wrap({ type: 'prompt', text: 'check CI' });
    expect(prompt).toMatchObject({ type: 'e2ee' });
    expect(JSON.stringify(prompt)).not.toContain('check CI');
    expect(JSON.stringify(ctx.auth)).not.toContain(ctx.token);
    const app = ctx.host.openFrame((prompt as { frame: string }).frame);
    expect(app?.app).toEqual({ type: 'prompt', text: 'check CI' });
    expect(ctx.host.openFrame((prompt as { frame: string }).frame)).toBeNull();
  });

  it('ignores a substituted Mac key and rejects a wrong phone token', () => {
    const ctx = pair();
    const started = ctx.phone.onRelayMessage(JSON.stringify({ type: 'paired' }));
    const hello = started.send[0] as { clientPublicKey: string; clientNonce: string };
    const other = new HostChannel(generateHostSecretKey(), () => true);
    const ready = other.readyFor({ v: 1, clientPublicKey: hello.clientPublicKey, clientNonce: hello.clientNonce });
    const ignored = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
    expect(ignored).toEqual({ forward: null, send: [] });

    const good = handshake();
    const resumed = good.phone.onRelayMessage(JSON.stringify({ type: 'paired' }));
    const hello2 = resumed.send[0] as { clientPublicKey: string; clientNonce: string };
    const liar = new HostChannel(good.secret, () => false);
    const ready2 = liar.readyFor({
      v: 1,
      clientPublicKey: hello2.clientPublicKey,
      clientNonce: hello2.clientNonce,
    });
    const auth = good.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready2 })).send[0] as {
      frame: string;
    };
    expect(liar.openFrame(auth.frame)?.reject).toBe(true);
  });

  it('holds prompts until the Mac accepts the phone token', () => {
    const ctx = pair();
    expect(ctx.phone.wrap({ type: 'prompt', text: 'early' })).toBeNull();
    expect(ctx.phone.wrap({ type: 'list_hosts', sessionTokens: ['route'] })).toEqual({
      type: 'list_hosts',
      sessionTokens: ['route'],
    });
    const started = ctx.phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'mac' }));
    expect(started.forward).toBeNull();
    const hello = started.send[0] as { clientPublicKey: string; clientNonce: string };
    const ready = ctx.host.readyFor({ v: 1, clientPublicKey: hello.clientPublicKey, clientNonce: hello.clientNonce });
    const accepted = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
    const opened = ctx.host.openFrame((accepted.send[0] as { frame: string }).frame);
    const flushed = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee', frame: opened?.okFrame }));
    expect(flushed.forward).toContain('paired');
    expect(flushed.send).toHaveLength(1);
    expect(ctx.host.openFrame((flushed.send[0] as { frame: string }).frame)?.app).toEqual({
      type: 'prompt',
      text: 'early',
    });
  });

  it('handshakes with the Mac in the paired message when switching desktops', () => {
    const work = pair('work-token');
    const home = pair('home-token');
    const phone = new PhoneChannel((hint) => {
      if (hint?.deviceId === 'mac-home' || hint?.sessionToken === 'home-sess') return home.material;
      return work.material;
    });
    const handshakeWith = (host: HostChannel, deviceId: string, sessionToken: string) => {
      const started = phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId, sessionToken }));
      const hello = started.send[0] as { clientPublicKey: string; clientNonce: string };
      const ready = host.readyFor({
        v: 1,
        clientPublicKey: hello.clientPublicKey,
        clientNonce: hello.clientNonce,
      });
      if (!ready) throw new Error('ready');
      const accepted = phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
      const auth = accepted.send[0] as { frame: string };
      const opened = host.openFrame(auth.frame);
      if (!opened?.okFrame) throw new Error('auth');
      return phone.onRelayMessage(JSON.stringify({ type: 'e2ee', frame: opened.okFrame }));
    };
    expect(handshakeWith(work.host, 'mac-work', 'work-sess').forward).toContain('paired');
    expect(handshakeWith(home.host, 'mac-home', 'home-sess').forward).toContain('paired');
    const prompt = phone.wrap({ type: 'prompt', text: 'home' });
    expect(home.host.openFrame((prompt as { frame: string }).frame)?.app).toEqual({
      type: 'prompt',
      text: 'home',
    });
  });

  it('ignores a ready frame from the Mac that was just left', () => {
    const work = pair();
    const home = pair();
    const phone = new PhoneChannel((hint) => (hint?.deviceId === 'home' ? home.material : work.material));
    const startedWork = phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'work' }));
    const helloWork = startedWork.send[0] as { clientPublicKey: string; clientNonce: string };
    const startedHome = phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'home' }));
    const helloHome = startedHome.send[0] as { clientPublicKey: string; clientNonce: string };
    const stale = work.host.readyFor({
      v: 1,
      clientPublicKey: helloWork.clientPublicKey,
      clientNonce: helloWork.clientNonce,
    });
    expect(phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...stale }))).toEqual({
      forward: null,
      send: [],
    });
    const ready = home.host.readyFor({
      v: 1,
      clientPublicKey: helloHome.clientPublicKey,
      clientNonce: helloHome.clientNonce,
    });
    const accepted = phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
    expect(accepted.send[0]).toMatchObject({ type: 'e2ee' });
  });

  it('ignores a ready that matches the pin but not this hello', () => {
    const ctx = pair();
    const first = ctx.phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'mac' }));
    const hello1 = first.send[0] as { clientPublicKey: string; clientNonce: string };
    const second = ctx.phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'mac' }));
    const hello2 = second.send[0] as { clientPublicKey: string; clientNonce: string };
    const stale = ctx.host.readyFor({
      v: 1,
      clientPublicKey: hello1.clientPublicKey,
      clientNonce: hello1.clientNonce,
    });
    expect(ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...stale }))).toEqual({
      forward: null,
      send: [],
    });
    const ready = ctx.host.readyFor({
      v: 1,
      clientPublicKey: hello2.clientPublicKey,
      clientNonce: hello2.clientNonce,
    });
    const accepted = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
    expect(accepted.send[0]).toMatchObject({ type: 'e2ee' });
  });

  it('drops a paired message for a Mac that is no longer selected', () => {
    const work = pair();
    const home = pair();
    const phone = new PhoneChannel(
      (hint) => (hint?.sessionToken === 'home-sess' ? home.material : work.material),
      () => ({ sessionToken: 'home-sess' }),
    );
    expect(
      phone.onRelayMessage(JSON.stringify({ type: 'paired', deviceId: 'mac-work', sessionToken: 'work-sess' })),
    ).toEqual({ forward: null, send: [] });
    const started = phone.onRelayMessage(
      JSON.stringify({ type: 'paired', deviceId: 'mac-home', sessionToken: 'home-sess' }),
    );
    expect(started.send[0]).toMatchObject({ type: 'e2ee_hello' });
  });
});
