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

  it('rejects a substituted Mac key and a wrong phone token', () => {
    const ctx = pair();
    const started = ctx.phone.onRelayMessage(JSON.stringify({ type: 'paired' }));
    const hello = started.send[0] as { clientPublicKey: string; clientNonce: string };
    const other = new HostChannel(generateHostSecretKey(), () => true);
    const ready = other.readyFor({ v: 1, clientPublicKey: hello.clientPublicKey, clientNonce: hello.clientNonce });
    const rejected = ctx.phone.onRelayMessage(JSON.stringify({ type: 'e2ee_ready', ...ready }));
    expect(JSON.parse(rejected.forward ?? '{}')).toMatchObject({ type: 'error' });

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
});
