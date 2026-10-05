import { WebSocket as WsWebSocket } from 'ws';
import { lookupPreferPublicDns } from '../slack/public-dns.js';
import { handleRemoteInbound, type RemoteOutbound } from './listen.js';
import {
  parseRemoteServerMessage,
  type RemoteHostMessage,
  type RemoteServerMessage,
} from './protocol.js';

export interface RemoteHostClientOptions {
  url: string;
  deviceId: string;
  deviceLabel: string;
  hostSecret: string;
  signal?: AbortSignal;
  onStatus?: (status: { connected: boolean; phoneConnected: boolean }) => void;
  onPairingCode?: (code: string | null) => void;
  onLog?: (line: string) => void;
}

export interface RemoteHostHandle {
  requestPairingCode(): void;
  /** Re-register this Mac so phones see a renamed desktop without a new pairing. */
  updateIdentity(deviceLabel: string): void;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Keep this Mac registered on the relay and run phone prompts on the
 * Global orchestrator. Reconnects until `signal` aborts.
 */
export function runRemoteHost(opts: RemoteHostClientOptions): RemoteHostHandle {
  const log = opts.onLog ?? (() => undefined);
  let socket: WsWebSocket | null = null;
  let wantPair = false;
  let deviceLabel = opts.deviceLabel;

  const send = (msg: RemoteHostMessage) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(msg));
  };

  const sendRegister = () => {
    send({
      type: 'host_register',
      deviceId: opts.deviceId,
      deviceLabel,
      hostSecret: opts.hostSecret,
    });
  };

  const loop = async () => {
    let backoff = BACKOFF_START_MS;
    while (!opts.signal?.aborted) {
      try {
        await connectOnce();
        backoff = BACKOFF_START_MS;
      } catch (err) {
        if (opts.signal?.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message !== 'aborted') log(`remote error: ${message}`);
      }
      opts.onStatus?.({ connected: false, phoneConnected: false });
      if (opts.signal?.aborted) return;
      log(`remote reconnect in ${Math.round(backoff / 1000)}s`);
      try {
        await wait(backoff, opts.signal);
      } catch {
        return;
      }
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  };

  const connectOnce = () =>
    new Promise<void>((resolve, reject) => {
      const ws = new WsWebSocket(opts.url, { lookup: lookupPreferPublicDns });
      socket = ws;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };
      const onAbort = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish();
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      ws.on('open', () => {
        log(`Remote connected · ${deviceLabel}`);
        opts.onStatus?.({ connected: true, phoneConnected: false });
        sendRegister();
        if (wantPair) send({ type: 'host_pair' });
      });
      ws.on('message', (data) => {
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        const msg = parseRemoteServerMessage(raw);
        if (!msg) return;
        handleServer(msg);
      });
      ws.on('close', () => finish());
      ws.on('error', (err) => finish(err instanceof Error ? err : new Error('remote socket error')));
    });

  const handleServer = (msg: RemoteServerMessage) => {
    if (msg.type === 'registered') {
      opts.onStatus?.({ connected: true, phoneConnected: false });
      return;
    }
    if (msg.type === 'pairing_code') {
      wantPair = false;
      opts.onPairingCode?.(msg.code);
      log(`pairing code ${msg.code}`);
      return;
    }
    if (msg.type === 'phone_joined') {
      opts.onPairingCode?.(null);
      opts.onStatus?.({ connected: true, phoneConnected: true });
      log('phone joined');
      return;
    }
    if (msg.type === 'phone_left') {
      opts.onStatus?.({ connected: true, phoneConnected: false });
      log('phone left');
      return;
    }
    if (msg.type === 'error') {
      log(`remote error: ${msg.message}`);
      return;
    }
    if (msg.type === 'stop') {
      handleRemoteInbound('stop', {
        deviceId: opts.deviceId,
        onLog: log,
        onOutbound: emit,
      });
      return;
    }
    if (msg.type === 'inbound') {
      handleRemoteInbound(msg.text, {
        deviceId: opts.deviceId,
        onLog: log,
        onOutbound: emit,
      });
    }
  };

  const emit = (outbound: RemoteOutbound) => {
    if (outbound.type === 'assistant') {
      send({ type: 'assistant', text: outbound.text });
      return;
    }
    send({ type: 'ask_user', text: outbound.text, questions: outbound.questions });
  };

  void loop();

  return {
    requestPairingCode() {
      wantPair = true;
      opts.onPairingCode?.(null);
      send({ type: 'host_pair' });
    },
    updateIdentity(label: string) {
      const next = label.trim();
      if (!next || next === deviceLabel) return;
      deviceLabel = next;
      log(`Remote connected · ${deviceLabel}`);
      sendRegister();
    },
  };
}
