import { randomBytes } from 'node:crypto';
import {
  parseRemoteClientMessage,
  type RemoteClientMessage,
  type RemoteHostSummary,
  type RemoteServerMessage,
} from './protocol.js';

export interface RemoteSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60 * 1000;

type HostSession = {
  deviceId: string;
  deviceLabel: string;
  hostSecret: string;
  socket: RemoteSocket;
  /** Survives the phone disconnecting so it can resume or switch away and back. */
  sessionToken: string | null;
  phone: RemoteSocket | null;
};

type RememberedHost = {
  hostSecret: string;
  sessionToken: string | null;
  deviceLabel: string;
};

type PairingCode = {
  code: string;
  deviceId: string;
  expiresAt: number;
};

function send(socket: RemoteSocket, msg: RemoteServerMessage): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // closed
  }
}

function newCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return code;
}

export type RemoteHostAuthorizer = (input: {
  accountToken: string;
  deviceId: string;
  deviceLabel: string;
  hostSecret: string;
}) => { ok: true } | { ok: false; message: string };

/**
 * In-memory phone ↔ Mac registry. One active phone socket per Mac.
 * A phone may hold session tokens for several Macs and attaches to one at a time.
 * Host secrets and session tokens survive that Mac reconnecting in this process.
 * A relay restart drops the live sockets — the phone pairs again. When an
 * authorizer is set, the account and host secret live in durable storage.
 */
export class RemoteHub {
  private readonly hosts = new Map<string, HostSession>();
  private readonly remembered = new Map<string, RememberedHost>();
  private readonly bySocket = new Map<RemoteSocket, { role: 'host' | 'phone'; deviceId: string }>();
  private readonly codes = new Map<string, PairingCode>();
  private readonly phonesByToken = new Map<string, string>();

  constructor(
    private readonly opts: {
      authorizeHost?: RemoteHostAuthorizer;
      onAuthorized?: (socket: RemoteSocket) => void;
    } = {},
  ) {}

  handleClientMessage(socket: RemoteSocket, raw: string): void {
    const msg = parseRemoteClientMessage(raw);
    if (!msg) {
      send(socket, { type: 'error', message: 'invalid message' });
      return;
    }
    if (msg.type === 'ping') {
      send(socket, { type: 'pong' });
      return;
    }
    this.dispatch(socket, msg);
  }

  detachSocket(socket: RemoteSocket): void {
    const bound = this.bySocket.get(socket);
    if (!bound) return;
    this.bySocket.delete(socket);
    const host = this.hosts.get(bound.deviceId);
    if (!host) return;
    if (bound.role === 'host' && host.socket === socket) {
      if (host.phone) {
        send(host.phone, { type: 'host_offline' });
        this.bySocket.delete(host.phone);
      }
      this.hosts.delete(bound.deviceId);
      return;
    }
    if (bound.role === 'phone' && host.phone === socket) {
      host.phone = null;
      send(host.socket, { type: 'phone_left' });
    }
  }

  private dispatch(socket: RemoteSocket, msg: RemoteClientMessage): void {
    if (msg.type === 'host_register') {
      this.registerHost(socket, msg.deviceId, msg.deviceLabel, msg.hostSecret, msg.accountToken ?? '');
      return;
    }
    if (msg.type === 'host_pair') {
      this.issueCode(socket);
      return;
    }
    if (msg.type === 'pair') {
      this.pairPhone(socket, msg.code);
      return;
    }
    if (msg.type === 'resume') {
      this.resumePhone(socket, msg.sessionToken);
      return;
    }
    if (msg.type === 'list_hosts') {
      this.listHosts(socket, msg.sessionTokens);
      return;
    }
    if (msg.type === 'prompt' || msg.type === 'stop') {
      this.fromPhone(socket, msg);
      return;
    }
    if (msg.type === 'assistant' || msg.type === 'ask_user') {
      this.fromHost(socket, msg);
    }
  }

  private registerHost(
    socket: RemoteSocket,
    deviceId: string,
    deviceLabel: string,
    hostSecret: string,
    accountToken: string,
  ): void {
    if (this.opts.authorizeHost) {
      const decision = this.opts.authorizeHost({ accountToken, deviceId, deviceLabel, hostSecret });
      if (!decision.ok) {
        send(socket, { type: 'error', message: decision.message });
        return;
      }
    }
    const prior = this.remembered.get(deviceId);
    const existing = this.hosts.get(deviceId);
    if ((prior && prior.hostSecret !== hostSecret) || (existing && existing.hostSecret !== hostSecret)) {
      send(socket, { type: 'error', message: 'host secret rejected' });
      return;
    }
    if (existing && existing.socket !== socket) {
      this.bySocket.delete(existing.socket);
      try {
        existing.socket.close();
      } catch {
        // ignore
      }
      if (existing.phone) {
        send(existing.phone, { type: 'host_offline' });
        this.bySocket.delete(existing.phone);
      }
    }
    const sessionToken = existing?.sessionToken ?? prior?.sessionToken ?? null;
    const host: HostSession = {
      deviceId,
      deviceLabel,
      hostSecret,
      socket,
      sessionToken,
      phone: existing?.socket === socket ? existing.phone : null,
    };
    this.hosts.set(deviceId, host);
    this.remembered.set(deviceId, { hostSecret, sessionToken, deviceLabel });
    this.bySocket.set(socket, { role: 'host', deviceId });
    send(socket, { type: 'registered', deviceId, deviceLabel });
    if (host.phone) send(socket, { type: 'phone_joined' });
    this.opts.onAuthorized?.(socket);
  }

  private issueCode(socket: RemoteSocket): void {
    const bound = this.bySocket.get(socket);
    const host = bound?.role === 'host' ? this.hosts.get(bound.deviceId) : null;
    if (!host || host.socket !== socket) {
      send(socket, { type: 'error', message: 'register this Mac before pairing' });
      return;
    }
    for (const [code, row] of this.codes) {
      if (row.deviceId === host.deviceId) this.codes.delete(code);
    }
    const code = newCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    this.codes.set(code, { code, deviceId: host.deviceId, expiresAt });
    send(socket, { type: 'pairing_code', code, expiresAt });
  }

  private pairPhone(socket: RemoteSocket, code: string): void {
    const row = this.codes.get(code);
    if (!row || row.expiresAt < Date.now()) {
      this.codes.delete(code);
      send(socket, { type: 'error', message: 'pairing code expired' });
      return;
    }
    const host = this.hosts.get(row.deviceId);
    if (!host) {
      send(socket, { type: 'error', message: 'Mac is offline' });
      return;
    }
    this.codes.delete(code);
    this.attachPhone(socket, host);
  }

  private resumePhone(socket: RemoteSocket, sessionToken: string): void {
    const deviceId = this.phonesByToken.get(sessionToken);
    const remembered = deviceId ? this.remembered.get(deviceId) : undefined;
    if (!deviceId || !remembered || remembered.sessionToken !== sessionToken) {
      send(socket, { type: 'error', message: 'phone session expired — pair again' });
      return;
    }
    const host = this.hosts.get(deviceId);
    if (!host) {
      send(socket, { type: 'host_offline' });
      return;
    }
    this.attachPhone(socket, host, sessionToken);
  }

  private listHosts(socket: RemoteSocket, sessionTokens: string[]): void {
    const hosts: RemoteHostSummary[] = sessionTokens.map((sessionToken) => {
      const deviceId = this.phonesByToken.get(sessionToken);
      const remembered = deviceId ? this.remembered.get(deviceId) : undefined;
      const valid = Boolean(deviceId && remembered && remembered.sessionToken === sessionToken);
      if (!valid || !deviceId || !remembered) {
        return { sessionToken, deviceId: '', deviceLabel: '', online: false };
      }
      const host = this.hosts.get(deviceId);
      return {
        sessionToken,
        deviceId,
        deviceLabel: host?.deviceLabel || remembered.deviceLabel,
        online: Boolean(host),
      };
    });
    send(socket, { type: 'hosts', hosts });
  }

  private releasePhoneSocket(socket: RemoteSocket): void {
    const bound = this.bySocket.get(socket);
    if (!bound || bound.role !== 'phone') return;
    const prev = this.hosts.get(bound.deviceId);
    this.bySocket.delete(socket);
    if (prev?.phone === socket) {
      prev.phone = null;
      send(prev.socket, { type: 'phone_left' });
    }
  }

  private attachPhone(socket: RemoteSocket, host: HostSession, sessionToken?: string): void {
    const bound = this.bySocket.get(socket);
    if (bound?.role === 'phone' && bound.deviceId !== host.deviceId) {
      this.releasePhoneSocket(socket);
    }
    const already = host.phone === socket;
    if (host.phone && host.phone !== socket) {
      this.bySocket.delete(host.phone);
      try {
        host.phone.close();
      } catch {
        // ignore
      }
      host.phone = null;
    }
    const token = sessionToken ?? randomBytes(24).toString('hex');
    if (host.sessionToken && host.sessionToken !== token) {
      this.phonesByToken.delete(host.sessionToken);
    }
    host.sessionToken = token;
    host.phone = socket;
    this.phonesByToken.set(token, host.deviceId);
    this.remembered.set(host.deviceId, {
      hostSecret: host.hostSecret,
      sessionToken: token,
      deviceLabel: host.deviceLabel,
    });
    this.bySocket.set(socket, { role: 'phone', deviceId: host.deviceId });
    this.opts.onAuthorized?.(socket);
    send(socket, {
      type: 'paired',
      deviceId: host.deviceId,
      deviceLabel: host.deviceLabel,
      sessionToken: token,
    });
    if (!already) send(host.socket, { type: 'phone_joined' });
  }

  private fromPhone(socket: RemoteSocket, msg: { type: 'prompt'; text: string } | { type: 'stop' }): void {
    const bound = this.bySocket.get(socket);
    const host = bound?.role === 'phone' ? this.hosts.get(bound.deviceId) : null;
    if (!host || host.phone !== socket) {
      send(socket, { type: 'error', message: 'pair this phone first' });
      return;
    }
    if (msg.type === 'stop') {
      send(host.socket, { type: 'stop' });
      return;
    }
    send(host.socket, { type: 'inbound', text: msg.text });
  }

  private fromHost(
    socket: RemoteSocket,
    msg: Extract<RemoteClientMessage, { type: 'assistant' | 'ask_user' }>,
  ): void {
    const bound = this.bySocket.get(socket);
    const host = bound?.role === 'host' ? this.hosts.get(bound.deviceId) : null;
    if (!host || host.socket !== socket || !host.phone) return;
    if (msg.type === 'assistant') {
      send(host.phone, { type: 'assistant', text: msg.text });
      return;
    }
    send(host.phone, { type: 'ask_user', text: msg.text, questions: msg.questions });
  }
}
