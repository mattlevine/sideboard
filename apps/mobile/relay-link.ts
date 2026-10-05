const PING_MS = 20_000;
const PONG_MS = 15_000;
const RESUME_MS = 1_500;

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
  onClose: () => void;
  attached: () => boolean;
  inChat: () => boolean;
  sessionToken: () => string | null;
}): RelayLink {
  let socket: WebSocket | null = null;
  const queue: object[] = [];
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearKeepalive = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    pingTimer = null;
    pongTimer = null;
  };

  const send: RelayLink['send'] = (payload) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return;
    }
    queue.push(payload);
    if (socket && socket.readyState === WebSocket.CONNECTING) return;
    clearKeepalive();
    const next = new WebSocket(opts.url().trim());
    socket = next;
    next.onmessage = (event) => opts.onMessage(String(event.data));
    next.onopen = () => {
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
    next.onerror = () => opts.onError('Could not reach the relay.');
    next.onclose = () => {
      clearKeepalive();
      if (socket === next) socket = null;
      opts.onClose();
      scheduleResume();
    };
  };

  const scheduleResume = () => {
    if (resumeTimer || !opts.inChat()) return;
    const token = opts.sessionToken();
    if (!token) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!opts.inChat() || opts.attached()) return;
      send({ type: 'resume', sessionToken: token });
    }, RESUME_MS);
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
