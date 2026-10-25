import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

/**
 * Phone ↔ Mac session encryption. The relay only forwards these frames.
 * The pairing line on the Mac screen pins the Mac's public key and carries
 * the phone token. That token is sent only inside the first encrypted frame.
 */

const PAIR_PREFIX = 'sb1';
const KEY_BYTES = 32;
const NONCE_BYTES = 32;

export type SealMaterial = {
  hostPublicKey: string;
  phoneToken: string;
};

/** Which saved Mac the phone is handshaking with. */
export type SealLookup = {
  deviceId?: string;
  sessionToken?: string;
};

export type PhoneHello = {
  v: 1;
  clientPublicKey: string;
  clientNonce: string;
};

export type HostReady = {
  v: 1;
  desktopPublicKey: string;
  clientNonce: string;
  desktopNonce: string;
};

type AppMessage = { type: string; [key: string]: unknown };

type Keys = {
  phoneToHost: Uint8Array;
  hostToPhone: Uint8Array;
};

let randomBytes = defaultRandom;

function defaultRandom(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('phone encryption needs a CSPRNG');
  const out = new Uint8Array(length);
  cryptoApi.getRandomValues(out);
  return out;
}

/** React Native calls this with expo-crypto. Node uses global crypto. */
export function setPhoneE2EERandom(fn: (length: number) => Uint8Array): void {
  randomBytes = fn;
}

export function generateHostSecretKey(): string {
  return bytesToB64url(clampPrivateKey(randomBytes(KEY_BYTES)));
}

export function hostPublicKey(secretKey: string): string {
  return bytesToB64url(x25519.getPublicKey(b64urlToBytes(secretKey)));
}

export function generatePhoneToken(): string {
  return bytesToB64url(randomBytes(KEY_BYTES));
}

/** Line the Mac shows and the phone pastes. The relay never sees this string. */
export function formatPairingBlob(code: string, publicKey: string, phoneToken: string): string {
  return `${PAIR_PREFIX}.${code.trim().toUpperCase()}.${publicKey.trim()}.${phoneToken.trim()}`;
}

export function parsePairingBlob(raw: string): { code: string; hostPublicKey: string; phoneToken: string } | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PAIR_PREFIX) return null;
  const code = parts[1]?.trim().toUpperCase() ?? '';
  const hostPublicKey = parts[2]?.trim() ?? '';
  const phoneToken = parts[3]?.trim() ?? '';
  if (!/^[A-Z2-9]{6}$/.test(code) || !hostPublicKey || !phoneToken) return null;
  return { code, hostPublicKey, phoneToken };
}

export class PhoneChannel {
  private session: DirectionalSeal | null = null;
  private sealed = false;
  private pairedRaw: string | null = null;
  private pin: SealMaterial | null = null;
  private readonly queue: object[] = [];

  constructor(
    private readonly material: (hint?: SealLookup) => SealMaterial | null,
    private readonly wanted?: () => SealLookup | null,
  ) {}

  reset(): void {
    this.session = null;
    this.sealed = false;
    this.pairedRaw = null;
    this.pin = null;
    this.queue.length = 0;
  }

  /**
   * Relay text the phone just received.
   * `forward` is what the UI should see. `send` goes back on the socket.
   */
  onRelayMessage(raw: string): { forward: string | null; send: object[] } {
    const msg = parseJson(raw);
    if (!msg) return { forward: raw, send: [] };
    if (msg.type === 'error') {
      const message = typeof msg.message === 'string' ? msg.message : '';
      // A duplicate Pair tap can race the handshake. Dropping that reply used
      // to reset the session that was about to finish.
      if (message === 'pairing code expired' && this.pairedRaw && !this.sealed) {
        return { forward: null, send: [] };
      }
      this.reset();
      return { forward: raw, send: [] };
    }
    if (msg.type === 'host_offline') {
      this.reset();
      return { forward: raw, send: [] };
    }
    if (msg.type === 'paired') return this.begin(raw);
    if (msg.type === 'e2ee_ready') return this.acceptReady(msg);
    if (msg.type === 'e2ee' && typeof msg.frame === 'string') return this.openFrame(msg.frame);
    return { forward: raw, send: [] };
  }

  /** App payload for the socket. Prompts wait until the handshake finishes. */
  wrap(payload: object): object | null {
    const type = (payload as { type?: unknown }).type;
    if (type !== 'prompt' && type !== 'stop') return payload;
    if (!this.sealed || !this.session) {
      this.queue.push(payload);
      return null;
    }
    return { type: 'e2ee', frame: this.session.seal(payload) };
  }

  private begin(raw: string): { forward: string | null; send: object[] } {
    this.session = null;
    this.sealed = false;
    this.pin = null;
    this.pairedRaw = raw;
    const msg = parseJson(raw);
    const hint: SealLookup | undefined = msg
      ? {
          ...(typeof msg.deviceId === 'string' && msg.deviceId ? { deviceId: msg.deviceId } : {}),
          ...(typeof msg.sessionToken === 'string' && msg.sessionToken ? { sessionToken: msg.sessionToken } : {}),
        }
      : undefined;
    const wanted = this.wanted?.();
    if (
      (wanted?.sessionToken && hint?.sessionToken && wanted.sessionToken !== hint.sessionToken) ||
      (wanted?.deviceId && hint?.deviceId && wanted.deviceId !== hint.deviceId)
    ) {
      return { forward: null, send: [] };
    }
    const pin = this.material(hint && (hint.deviceId || hint.sessionToken) ? hint : undefined);
    if (!pin) {
      this.reset();
      return {
        forward: JSON.stringify({ type: 'error', message: 'phone session expired — pair again' }),
        send: [],
      };
    }
    this.pin = pin;
    const clientSecret = clampPrivateKey(randomBytes(KEY_BYTES));
    const clientNonce = randomBytes(NONCE_BYTES);
    const hello: PhoneHello = {
      v: 1,
      clientPublicKey: bytesToB64url(x25519.getPublicKey(clientSecret)),
      clientNonce: bytesToB64url(clientNonce),
    };
    this.session = new DirectionalSeal(clientSecret, pin.hostPublicKey, hello, clientNonce, 'phone');
    return { forward: null, send: [{ type: 'e2ee_hello', ...hello }] };
  }

  private acceptReady(msg: Record<string, unknown>): { forward: string | null; send: object[] } {
    const pin = this.pin ?? this.material();
    const ready = asReady(msg);
    if (!ready) return { forward: null, send: [] };
    if (!this.session || !pin) {
      this.reset();
      return {
        forward: JSON.stringify({ type: 'error', message: 'phone session expired — pair again' }),
        send: [],
      };
    }
    // A ready for an older hello (the Mac you just left) has a different nonce.
    // Drop it. A ready for this hello with a different key means the Mac changed.
    if (!this.session.matchesClientNonce(ready.clientNonce)) {
      return { forward: null, send: [] };
    }
    if (!equalText(ready.desktopPublicKey, pin.hostPublicKey)) {
      this.reset();
      return {
        forward: JSON.stringify({
          type: 'error',
          message: 'This Mac changed. Show a new pairing code and scan it.',
        }),
        send: [],
      };
    }
    if (!this.session.acceptReady(ready)) {
      return { forward: null, send: [] };
    }
    const frame = this.session.seal({
      type: 'e2ee_auth',
      v: 1,
      transcript: this.session.transcript,
      token: pin.phoneToken,
    });
    return { forward: null, send: [{ type: 'e2ee', frame }] };
  }

  private openFrame(frame: string): { forward: string | null; send: object[] } {
    const opened = this.session?.open(frame) ?? null;
    if (!opened || !this.session) return { forward: null, send: [] };
    if (opened.type === 'e2ee_ok' && opened.transcript === this.session.transcript) {
      this.sealed = true;
      const pending = this.queue.splice(0);
      const forward = this.pairedRaw;
      this.pairedRaw = null;
      return {
        forward,
        send: pending.map((payload) => ({ type: 'e2ee', frame: this.session!.seal(payload) })),
      };
    }
    if (opened.type === 'e2ee_auth' || opened.type === 'e2ee_ok') return { forward: null, send: [] };
    return { forward: JSON.stringify(opened), send: [] };
  }
}

export class HostChannel {
  private session: DirectionalSeal | null = null;
  private authed = false;

  constructor(
    private readonly secretKey: string,
    private readonly acceptToken: (token: string) => boolean,
  ) {}

  reset(): void {
    this.session = null;
    this.authed = false;
  }

  readyFor(hello: PhoneHello): HostReady | null {
    this.reset();
    let secret: Uint8Array;
    let pinned: string;
    try {
      secret = b64urlToBytes(this.secretKey);
      pinned = hostPublicKey(this.secretKey);
    } catch {
      return null;
    }
    if (hello.v !== 1 || !hello.clientPublicKey || !hello.clientNonce) return null;
    const clientNonce = b64urlToBytes(hello.clientNonce);
    if (clientNonce.length !== NONCE_BYTES) return null;
    const desktopNonce = randomBytes(NONCE_BYTES);
    const ready: HostReady = {
      v: 1,
      desktopPublicKey: pinned,
      clientNonce: hello.clientNonce,
      desktopNonce: bytesToB64url(desktopNonce),
    };
    this.session = new DirectionalSeal(secret, hello.clientPublicKey, hello, clientNonce, 'host');
    if (!this.session.acceptReady(ready, desktopNonce)) {
      this.reset();
      return null;
    }
    return ready;
  }

  openFrame(frame: string): { okFrame?: string; app?: AppMessage; reject?: boolean } | null {
    const opened = this.session?.open(frame) ?? null;
    if (!opened || !this.session) return this.authed ? null : { reject: true };
    if (!this.authed) {
      if (opened.type !== 'e2ee_auth' || opened.v !== 1) return { reject: true };
      if (opened.transcript !== this.session.transcript) return { reject: true };
      if (typeof opened.token !== 'string' || !this.acceptToken(opened.token)) return { reject: true };
      this.authed = true;
      return {
        okFrame: this.session.seal({ type: 'e2ee_ok', v: 1, transcript: this.session.transcript }),
      };
    }
    if (opened.type === 'e2ee_auth' || opened.type === 'e2ee_ok') return null;
    return { app: opened };
  }

  sealApp(message: object): string | null {
    if (!this.authed || !this.session) return null;
    return this.session.seal(message);
  }
}

class DirectionalSeal {
  private keys: Keys | null = null;
  private sendCounter = 0;
  private recvCounter = 0;
  transcript = '';
  private readonly sendDirection: 1 | 2;

  constructor(
    private readonly secretKey: Uint8Array,
    private readonly peerPublicKey: string,
    private readonly hello: PhoneHello,
    private readonly clientNonce: Uint8Array,
    role: 'phone' | 'host',
  ) {
    this.sendDirection = role === 'phone' ? 1 : 2;
  }

  matchesClientNonce(clientNonce: string): boolean {
    return clientNonce === this.hello.clientNonce;
  }

  acceptReady(ready: HostReady, desktopNonceBytes?: Uint8Array): boolean {
    if (ready.v !== 1 || !this.matchesClientNonce(ready.clientNonce)) return false;
    const desktopNonce = desktopNonceBytes ?? b64urlToBytes(ready.desktopNonce);
    if (desktopNonce.length !== NONCE_BYTES) return false;
    let shared: Uint8Array;
    try {
      shared = x25519.getSharedSecret(this.secretKey, b64urlToBytes(this.peerPublicKey));
    } catch {
      return false;
    }
    if (shared.length !== KEY_BYTES) return false;
    const transcriptBytes = utf8(canonicalTranscript(this.hello, ready));
    const transcriptHash = sha256(transcriptBytes);
    this.transcript = bytesToB64url(transcriptHash);
    const salt = sha256(concat([utf8('sideboard-phone-e2ee/v1/salt\0'), this.clientNonce, desktopNonce]));
    const info = concat([utf8('sideboard-phone-e2ee/v1/session\0'), transcriptHash]);
    const expanded = hkdf(sha256, shared, salt, info, 64);
    const phoneToHost = expanded.slice(0, 32);
    const hostToPhone = expanded.slice(32, 64);
    this.keys = { phoneToHost, hostToPhone };
    return true;
  }

  seal(message: object): string {
    if (!this.keys) throw new Error('phone encryption is not ready');
    const key = this.sendDirection === 1 ? this.keys.phoneToHost : this.keys.hostToPhone;
    const frame = sealFrame(key, this.sendDirection, this.sendCounter, utf8(JSON.stringify(message)));
    this.sendCounter += 1;
    return bytesToB64url(frame);
  }

  open(frame: string): AppMessage | null {
    if (!this.keys) return null;
    const bytes = b64urlToBytes(frame);
    const direction: 1 | 2 = this.sendDirection === 1 ? 2 : 1;
    const key = direction === 1 ? this.keys.phoneToHost : this.keys.hostToPhone;
    const plain = openFrame(key, direction, this.recvCounter, bytes);
    if (!plain) return null;
    this.recvCounter += 1;
    const parsed = parseJson(new TextDecoder().decode(plain));
    if (!parsed || typeof parsed.type !== 'string') return null;
    return parsed as AppMessage;
  }
}

function canonicalTranscript(hello: PhoneHello, ready: HostReady): string {
  return JSON.stringify({
    v: 1,
    clientPublicKey: hello.clientPublicKey,
    clientNonce: hello.clientNonce,
    desktopPublicKey: ready.desktopPublicKey,
    desktopNonce: ready.desktopNonce,
  });
}

function sealFrame(key: Uint8Array, direction: 1 | 2, counter: number, plain: Uint8Array): Uint8Array {
  const nonce = frameNonce(direction, counter);
  const boxed = chacha20poly1305(key, nonce).encrypt(plain);
  const out = new Uint8Array(1 + 1 + 8 + boxed.length);
  out[0] = 1;
  out[1] = direction;
  writeCounter(out, 2, counter);
  out.set(boxed, 10);
  return out;
}

function openFrame(key: Uint8Array, direction: 1 | 2, counter: number, frame: Uint8Array): Uint8Array | null {
  if (frame.length < 10 + 16 || frame[0] !== 1 || frame[1] !== direction) return null;
  if (readCounter(frame, 2) !== counter) return null;
  try {
    return chacha20poly1305(key, frameNonce(direction, counter)).decrypt(frame.subarray(10));
  } catch {
    return null;
  }
}

function frameNonce(direction: number, counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce[0] = direction;
  writeCounter(nonce, 4, counter);
  return nonce;
}

function writeCounter(buf: Uint8Array, offset: number, counter: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, Math.floor(counter / 0x100000000));
  view.setUint32(offset + 4, counter >>> 0);
}

function readCounter(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint32(offset) * 0x100000000 + view.getUint32(offset + 4);
}

function asReady(msg: Record<string, unknown>): HostReady | null {
  if (msg.v !== 1) return null;
  if (typeof msg.desktopPublicKey !== 'string' || typeof msg.clientNonce !== 'string') return null;
  if (typeof msg.desktopNonce !== 'string') return null;
  return {
    v: 1,
    desktopPublicKey: msg.desktopPublicKey,
    clientNonce: msg.clientNonce,
    desktopNonce: msg.desktopNonce,
  };
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function equalText(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function clampPrivateKey(key: Uint8Array): Uint8Array {
  const out = new Uint8Array(key);
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlToBytes(text: string): Uint8Array {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
