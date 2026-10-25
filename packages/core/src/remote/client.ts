import { WebSocket as WsWebSocket } from 'ws';
import { systemCaTlsOptions } from '../http/system-ca.js';
import { lookupPreferPublicDns } from '../slack/public-dns.js';
import { handleRemoteInbound, type RemoteOutbound } from './listen.js';
import { startPhoneBoardSync } from './phone-board-sync.js';
import { refreshPhoneViewerLogin } from './phone-viewer-login.js';
import { deliverPhoneTurn, emitControl, getPhoneOpenChat, setPhoneOpenChat } from './phone-live.js';
import { setPhonePermissionPush } from './phone-permission.js';
import {
  generatePhoneToken,
  HostChannel,
  hostPublicKey,
  formatPairingBlob,
} from './phone-e2ee.js';
import {
  parseRemoteServerMessage,
  REMOTE_PING_INTERVAL_MS,
  REMOTE_PONG_TIMEOUT_MS,
  type RemoteHostMessage,
  type RemoteServerMessage,
} from './protocol.js';

export interface RemoteHostClientOptions {
  url: string;
  deviceId: string;
  deviceLabel: string;
  hostSecret: string;
  /** Long-term X25519 seed for the phone session. Vaulted on this Mac. */
  hostPrivateKey: string;
  /** Phone token from the last successful pairing. */
  phoneToken?: string | null;
  /** Persist a phone token after the encrypted handshake accepts it. */
  onPhoneToken?: (token: string) => void;
  /** Sideboard account credential from Settings → Remote. */
  accountToken?: string;
  signal?: AbortSignal;
  onStatus?: (status: { connected: boolean; phoneConnected: boolean }) => void;
  onPairingCode?: (code: string | null) => void;
  onLog?: (line: string) => void;
  /** Mac speech recognizer for a phone recording (wav base64). */
  transcribeWav?: (wavBase64: string) => Promise<string>;
  /** Open a worktree file or folder in the desktop window. */
  onOpenWorktreeFile?: (request: import('./phone-media.js').PhoneOpenFileRequest) => void;
  /** Open a chat artifact in the desktop side column. */
  onOpenArtifact?: (request: import('./phone-artifact.js').PhoneOpenArtifactRequest) => void;
  /** Tests: override keepalive cadence. */
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
}

export interface RemoteHostHandle {
  requestPairingCode(): void;
  /** Re-register this Mac so phones see a renamed desktop without a new pairing. */
  updateIdentity(deviceLabel: string): void;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

const RELAY_TLS_RE =
  /UNABLE_TO_GET_ISSUER|unable to get local issuer|SELF_SIGNED_CERT_IN_CHAIN/i;
const RELAY_TLS_HINT =
  ' — the TLS certificate was rejected. GitHub login can still work (browser Keychain trust); the relay socket uses Node TLS, which needs the corporate CA.';

export function formatRemoteHostError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'aborted') return message;
  if (RELAY_TLS_RE.test(message)) return `${message}${RELAY_TLS_HINT}`;
  return message;
}

/** JSON ping/pong. A missing pong means the socket is half-open and should reconnect. */
export function createRemoteKeepalive(opts: {
  intervalMs: number;
  pongTimeoutMs: number;
  sendPing: () => void;
  onTimeout: () => void;
}): { gotPong: () => void; stop: () => void } {
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (pongTimer) clearTimeout(pongTimer);
    pongTimer = setTimeout(() => {
      pongTimer = null;
      opts.onTimeout();
    }, opts.pongTimeoutMs);
  };
  const ping = () => {
    opts.sendPing();
    arm();
  };
  ping();
  const pingTimer = setInterval(ping, opts.intervalMs);
  return {
    gotPong() {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
    },
    stop() {
      clearInterval(pingTimer);
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
    },
  };
}

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
  let savedPhoneToken = opts.phoneToken?.trim() || null;
  let pendingPhoneToken: { token: string; expiresAt: number } | null = null;
  const PAIR_TTL_MS = 10 * 60 * 1000;
  const hostSeal = new HostChannel(opts.hostPrivateKey, (token) => {
    const pending = pendingPhoneToken;
    if (pending && pending.expiresAt > Date.now() && pending.token === token) {
      pendingPhoneToken = null;
      savedPhoneToken = token;
      opts.onPhoneToken?.(token);
      return true;
    }
    return Boolean(savedPhoneToken && savedPhoneToken === token);
  });
  let keepalive: ReturnType<typeof createRemoteKeepalive> | null = null;
  let connectionGen = 0;
  let stopBoard: (() => void) | null = null;

  const stopBoardSync = () => {
    stopBoard?.();
    stopBoard = null;
  };

  const startBoardSync = () => {
    stopBoardSync();
    stopBoard = startPhoneBoardSync({
      openChatId: getPhoneOpenChat,
      onSidebar: (sidebar) => {
        emitControl({ onOutbound: emit }, { op: 'sidebar', ...sidebar });
      },
      onRunningChat: (chatId) => {
        deliverPhoneTurn({ onOutbound: emit }, chatId);
      },
      refreshViewerLogin: () => refreshPhoneViewerLogin(true),
    });
  };

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
      ...(opts.accountToken?.trim() ? { accountToken: opts.accountToken.trim() } : {}),
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
        const message = formatRemoteHostError(err);
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
      const gen = ++connectionGen;
      stopBoardSync();
      setPhoneOpenChat(null);
      const ws = new WsWebSocket(opts.url, {
        lookup: lookupPreferPublicDns,
        ...systemCaTlsOptions(),
      });
      socket = ws;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (gen === connectionGen) {
          stopBoardSync();
          setPhoneOpenChat(null);
        }
        keepalive?.stop();
        keepalive = null;
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
        keepalive = createRemoteKeepalive({
          intervalMs: opts.pingIntervalMs ?? REMOTE_PING_INTERVAL_MS,
          pongTimeoutMs: opts.pongTimeoutMs ?? REMOTE_PONG_TIMEOUT_MS,
          sendPing: () => send({ type: 'ping' }),
          onTimeout: () => {
            log('remote error: ping timeout');
            finish(new Error('remote ping timeout'));
            try {
              ws.close();
            } catch {
              // ignore
            }
          },
        });
      });
      ws.on('message', (data) => {
        if (gen !== connectionGen) return;
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        const msg = parseRemoteServerMessage(raw);
        if (!msg) return;
        if (msg.type === 'phone_left') {
          hostSeal.reset();
          setPhoneOpenChat(null);
          stopBoardSync();
        }
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
      const pending = pendingPhoneToken;
      if (!pending || pending.expiresAt <= Date.now() || !opts.hostPrivateKey) {
        opts.onPairingCode?.(null);
        return;
      }
      opts.onPairingCode?.(formatPairingBlob(msg.code, hostPublicKey(opts.hostPrivateKey), pending.token));
      log('pairing line ready');
      return;
    }
    if (msg.type === 'phone_joined') {
      hostSeal.reset();
      return;
    }
    if (msg.type === 'e2ee_hello') {
      const ready = hostSeal.readyFor({
        v: 1,
        clientPublicKey: msg.clientPublicKey,
        clientNonce: msg.clientNonce,
      });
      if (ready) send({ type: 'e2ee_ready', ...ready });
      else send({ type: 'e2ee_fail' });
      return;
    }
    if (msg.type === 'e2ee') {
      const opened = hostSeal.openFrame(msg.frame);
      if (!opened) return;
      if (opened.reject) {
        hostSeal.reset();
        send({ type: 'e2ee_fail' });
        return;
      }
      if (opened.okFrame) {
        send({ type: 'e2ee', frame: opened.okFrame });
        try {
          startBoardSync();
        } catch (err) {
          log(`remote error: ${err instanceof Error ? err.message : err}`);
        }
        opts.onPairingCode?.(null);
        send({ type: 'pairing_done' });
        opts.onStatus?.({ connected: true, phoneConnected: true });
        log('phone joined');
        return;
      }
      if (opened.app?.type === 'stop') {
        handleRemoteInbound('stop', {
          deviceId: opts.deviceId,
          onLog: log,
          onOutbound: emit,
          onOpenWorktreeFile: opts.onOpenWorktreeFile,
        });
        return;
      }
      if (opened.app?.type === 'prompt' && typeof opened.app.text === 'string') {
        handleRemoteInbound(opened.app.text, {
          deviceId: opts.deviceId,
          onLog: log,
          onOutbound: emit,
          transcribeWav: opts.transcribeWav,
          onOpenWorktreeFile: opts.onOpenWorktreeFile,
          onOpenArtifact: opts.onOpenArtifact,
        });
      }
      return;
    }
    if (msg.type === 'phone_left') {
      opts.onStatus?.({ connected: true, phoneConnected: false });
      log('phone left');
      return;
    }
    if (msg.type === 'pong') {
      keepalive?.gotPong();
      return;
    }
    if (msg.type === 'error') {
      log(`remote error: ${msg.message}`);
      return;
    }
    if (msg.type === 'stop' || msg.type === 'inbound') return;
  };

  const emit = (outbound: RemoteOutbound) => {
    const frame = hostSeal.sealApp(
      outbound.type === 'assistant'
        ? { type: 'assistant', text: outbound.text }
        : { type: 'ask_user', text: outbound.text, questions: outbound.questions },
    );
    if (!frame) return;
    send({ type: 'e2ee', frame });
  };

  setPhonePermissionPush((chatId, prompt) => {
    if (getPhoneOpenChat() !== chatId) return;
    emitControl({ onOutbound: emit }, { op: 'permission', chatId, prompt });
  });

  void loop();

  return {
    requestPairingCode() {
      pendingPhoneToken = { token: generatePhoneToken(), expiresAt: Date.now() + PAIR_TTL_MS };
      wantPair = true;
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
