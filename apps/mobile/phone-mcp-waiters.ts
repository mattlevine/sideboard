/** In-flight phone MCP App requests. One map for every chat and WebView. */

export type PhoneMcpWaiterReply = {
  op?: string;
  reqId?: string;
  view?: unknown;
  result?: unknown;
  error?: string;
};

const waiters = new Map<string, (reply: PhoneMcpWaiterReply) => void>();
let seq = 0;

/** Unique on the wire. JSON-RPC ids restart at 1 in every app, so they must not be the key. */
export function nextPhoneMcpReqId(): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `r${seq.toString(36)}${rand}`.slice(0, 40);
}

export function deliverPhoneMcpWaiter(control: { op?: string; reqId?: string } & PhoneMcpWaiterReply): boolean {
  if (control.op !== 'mcp-ui' && control.op !== 'mcp-ui-call' && control.op !== 'mcp-ui-read') return false;
  const reqId = control.reqId;
  const wait = reqId ? waiters.get(reqId) : undefined;
  if (wait && reqId) {
    waiters.delete(reqId);
    wait(control);
  }
  return true;
}

export function askPhoneMcp(
  send: (payload: object) => void,
  payload: { reqId: string; [key: string]: unknown },
  timeoutMs = 20_000,
): Promise<PhoneMcpWaiterReply | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const waiter = (reply: PhoneMcpWaiterReply) => {
      clearTimeout(timer);
      resolve(reply);
    };
    timer = setTimeout(() => {
      if (waiters.get(payload.reqId) === waiter) waiters.delete(payload.reqId);
      resolve(null);
    }, timeoutMs);
    waiters.set(payload.reqId, waiter);
    send(payload);
  });
}
