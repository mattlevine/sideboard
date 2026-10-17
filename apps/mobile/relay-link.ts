const PING_MS = 20_000;
const PONG_MS = 15_000;
const RESUME_MS = 1_500;

export const RELAY_UNREACHABLE = 'Could not reach the relay.';

export type RelayLinkPhase = 'up' | 'retrying' | 'down';

export type RelayReconnect = 'resume' | 'connect' | 'hosts' | 'up' | 'stop';

/**
 * What a dropped socket should do next. The desktop list is refreshed even
 * when no Mac is selected. `stop` means there is nothing to try again.
 */
export function relayReconnectAction(input: {
  attached: boolean;
  inChat: boolean;
  hasSession: boolean;
  queued: boolean;
  hasHosts: boolean;
}): RelayReconnect {
  if (input.attached) return 'up';
  if (input.inChat && input.hasSession) return 'resume';
  if (input.queued) return 'connect';
  if (input.hasHosts) return 'hosts';
  return 'stop';
}

function relayDropCanRetry(action: RelayReconnect): boolean {
  return action === 'resume' || action === 'connect' || action === 'hosts';
}

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
  /** Saved desktops are on screen, so a drop can re-list them with none selected. */
  hasHosts?: () => boolean;
  attached: () => boolean;
  inChat: () => boolean;
  sessionToken: () => string | null;
}): RelayLink {
  let socket: WebSocket | null = null;
  let openedFor: string | null = null;
  const retired = new Set<WebSocket>();
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
    const target = opts.url().trim();
    if (
      socket &&
      openedFor === target &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    clearKeepalive();
    if (socket) {
      retired.add(socket);
      socket.close();
      socket = null;
      openedFor = null;
    }
    const next = new WebSocket(target);
    socket = next;
    openedFor = target;
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
      if (retired.has(next)) {
        retired.delete(next);
        return;
      }
      if (settled) return;
      settled = true;
      clearKeepalive();
      if (socket === next) socket = null;
      opts.onClose();
      const step = nextRelayPhase(phase, relayDropCanRetry(reconnectAction()));
      phase = step.phase;
      if (step.reportError) opts.onError(RELAY_UNREACHABLE);
      if (step.retry) scheduleReconnect();
    };
  };

  const send: RelayLink['send'] = (payload) => {
    const target = opts.url().trim();
    if (socket && openedFor === target && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return;
    }
    queue.push(payload);
    connect();
  };

  const reconnectAction = () =>
    relayReconnectAction({
      attached: opts.attached(),
      inChat: opts.inChat(),
      hasSession: Boolean(opts.sessionToken()),
      queued: queue.length > 0,
      hasHosts: Boolean(opts.hasHosts?.()),
    });

  const scheduleReconnect = () => {
    if (resumeTimer) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      const action = reconnectAction();
      if (action === 'up') {
        phase = 'up';
        return;
      }
      const token = opts.sessionToken();
      if (action === 'resume' && token) {
        send({ type: 'resume', sessionToken: token });
        return;
      }
      if (action === 'connect') {
        connect();
        return;
      }
      if (action === 'hosts') opts.onNeedsRetry?.();
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
