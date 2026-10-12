const PING_MS = 20_000;
const PONG_MS = 15_000;
const RESUME_MS = 1_500;

export const RELAY_UNREACHABLE = 'Could not reach the relay.';

export type RelayLinkPhase = 'up' | 'retrying' | 'down';

/**
 * A dropped socket retries once before the phone says the relay is down.
 * Further retries stay quiet until a connection opens again.
 */
export function nextRelayPhase(
  phase: RelayLinkPhase,
  canRetry: boolean,
): { phase: RelayLinkPhase; reportError: boolean; retry: boolean } {
  if (!canRetry) return { phase: 'down', reportError: true, retry: false };
  if (phase === 'retrying') return { phase: 'down', reportError: true, retry: true };
  if (phase === 'down') return { phase: 'down', reportError: false, retry: true };
  return { phase: 'retrying', reportError: false, retry: true };
}

export type RelayLink = {
  send(payload: object): void;
  scheduleResume(): void;
  cancelResume(): void;
  notePong(): void;
};

/**
 * Phone ↔ relay socket. JSON pings detect a half-open connection, and a
 * dropped Mac is resumed with the stored session token instead of waiting
 * for the user to pair again.
 */
export function createRelayLink(opts: {
  url: () => string;
  onMessage: (raw: string) => void;
  onError: (message: string) => void;
  /** A socket opened. Clears a relay error from a reconnect that has since succeeded. */
  onOpen?: () => void;
  onClose: () => void;
  /** Desktop list has nothing queued, so the phone asks again after a drop. */
  onNeedsRetry?: () => void;
  attached: () => boolean;
  inChat: () => boolean;
  sessionToken: () => string | null;
}): RelayLink {
  let socket: WebSocket | null = null;
  const queue: object[] = [];
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let phase: RelayLinkPhase = 'up';

  const clearKeepalive = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    pingTimer = null;
    pongTimer = null;
  };

  const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    clearKeepalive();
    const next = new WebSocket(opts.url().trim());
    socket = next;
    let settled = false;
    next.onmessage = (event) => opts.onMessage(String(event.data));
    next.onerror = () => {
      if (!settled && next.readyState !== WebSocket.CLOSED) next.close();
    };
    next.onopen = () => {
      phase = 'up';
      opts.onOpen?.();
      const ping = () => {
        if (next.readyState !== WebSocket.OPEN) return;
        next.send(JSON.stringify({ type: 'ping' }));
        if (pongTimer) clearTimeout(pongTimer);
        pongTimer = setTimeout(() => next.close(), PONG_MS);
      };
      ping();
      pingTimer = setInterval(ping, PING_MS);
      const queued = queue.splice(0);
      for (const item of queued) next.send(JSON.stringify(item));
    };
    next.onclose = () => {
      if (settled) return;
      settled = true;
      clearKeepalive();
      if (socket === next) socket = null;
      opts.onClose();
      const step = nextRelayPhase(phase, queue.length > 0 || Boolean(opts.sessionToken()));
      phase = step.phase;
      if (step.reportError) opts.onError(RELAY_UNREACHABLE);
      if (step.retry) scheduleReconnect();
    };
  };

  const send: RelayLink['send'] = (payload) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return;
    }
    queue.push(payload);
    connect();
  };

  const scheduleReconnect = () => {
    if (resumeTimer) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (opts.attached()) {
        phase = 'up';
        return;
      }
      const token = opts.sessionToken();
      if (opts.inChat() && token) {
        send({ type: 'resume', sessionToken: token });
        return;
      }
      if (queue.length > 0) {
        connect();
        return;
      }
      if (token) opts.onNeedsRetry?.();
    }, RESUME_MS);
  };

  const scheduleResume = () => {
    if (!opts.inChat() || !opts.sessionToken()) return;
    scheduleReconnect();
  };

  return {
    send,
    scheduleResume,
    cancelResume() {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = null;
    },
    notePong() {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
    },
  };
}
